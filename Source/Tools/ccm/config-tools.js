//@ts-check
const xpath = require('xpath');
const { DOMParser, XMLSerializer } = require('xmldom');
const fs = require('fs-extra');
const winston = require('winston');
const IniParser = require('./ini-parser');
const os = require('os');
const path = require('path');
const { Paths } = require('./paths');
const { ErrorAndReject, ErrorAndRejectConsole, InfoAndResolve, InfoAndResolveConsole, Spawn, RandomString, SafeIniString } = require('./helpers');

/** Регулярное выражение для имен переменной. */
const VariableNameRegex = /^([a-zA-z]+[a-zA-z0-9]*\.)*[a-zA-z]+[a-zA-z0-9]*$/;

/** Опции парсера INI-файлов. */
const IniParserOptions = Object.freeze({
    merge: true,
    dotKey: false,
    inherit: false,
    array: false,
    mstring: false,
    ignoreMissingAssign: false,
    nativeType: false,
    escapeCharKey: false,
    escapeCharValue: false,
    ignoreInvalidStringKey: false,
    ignoreInvalidStringValue: false,
    assign: ['='],
    lineComment: [';'],
    blockComment: false
});

/**
 * @typedef {number} VariableKind 
 */


/** Перечисление видов переменных.
 * @enum {VariableKind}
 */
const VariableKinds = Object.freeze({

    /** Скрытая переменная (значение по-умолчанию).  */
    Hidden: 0,

    /** Основная переменная.  */
    Essential: 1,

    /** Расширенная переменная.  */
    Advanced: 2

});

/**
 * @typedef {Object} VariableDef - Контейнер определения переменной.
 * @property {string} name - Имя переменной.
 * @property {string} description - Описание переменной.
 * @property {string} defaultValue - Значение переменной по-умолчанию.
 * @property {VariableKind} kind - Вид переменной.
 * @property {Object.<string, string>} attributes - Строковый словарь всех атрибутов определения переменной.
 */

/**
 * Выполнить чтение и разбор файла объявления переменных в формате XML.
 * @param {string} filePath путь до файла переменных.
 * @return {Promise<{doc: Document, definitions: Object.<string, VariableDef>}>}
 */
function LoadVarsDefinitionXml(filePath) {

    const errorMessage = `Failed to load variables definition from [${filePath}]`;

    return new Promise((resolve, reject) => {

        fs.readFile(filePath, 'utf-8').then(data => {

            /** @type {Object.<string, VariableDef>} */
            const variables = {};

            try {

                // Загружаем документ.
                const doc = new DOMParser().parseFromString(data, 'application/xml');

                // Проходим по определениям переменных.
                const definitionElements = /** @type {Element[]} */ (xpath.select('/Settings/Definition/VariableDefinition', doc));
                for (let definitionNode of definitionElements) {

                    const name = definitionNode.getAttribute('name');
                    const description = definitionNode.getAttribute('description');

                    if (!name)
                        return reject(new Error(`${errorMessage}: missing 'name' attribute for <VariableDefinition/>.`));

                    // Проверяем имя переменной регулярным выражением.
                    if (!VariableNameRegex.test(name))
                        return reject(new Error(`${errorMessage}: invalid value '${name}' for 'name' attribute for <VariableDefinition/>.`));

                    if (!description)
                        return reject(new Error(`${errorMessage}: missing 'description' attribute for <VariableDefinition name="${name}" /> node.`));

                    var variable = {
                        name: name,
                        description: description,
                        defaultValue: null,
                        kind: VariableKinds.Hidden,
                        attributes: {}
                    }

                    var attrs = definitionNode.attributes;
                    for (var i = 0; i < attrs.length; i++) {
                        const attr = attrs[i];
                        variable.attributes[attr.name] = attr.value;

                        if (attr.name && attr.name.toLowerCase() === 'kind' && attr.value) {

                            switch (attr.value.toLowerCase()) {

                                case 'essential':
                                    variable.kind = VariableKinds.Essential;
                                    break;


                                case 'advanced':
                                    variable.kind = VariableKinds.Advanced;
                                    break;


                                case 'hidden':
                                    variable.kind = VariableKinds.Hidden;
                                    break;

                            }
                        }
                    }

                    if (variables[name])
                        return reject(new Error(`${errorMessage}: duplicate definition of '${name}' variable.`));

                    variables[name] = variable;
                }

                // Проходим по значениям переменных.
                const variableElements = /** @type {Element[]} */ (xpath.select('/Settings/Configuration/Variable', doc));
                for (let variableNode of variableElements) {

                    const name = variableNode.getAttribute('name');

                    if (!name)
                        return reject(new Error(`${errorMessage}: missing 'name' attribute for <Variable/> node.`));

                    if (variableNode.childNodes.length != 1)
                        return reject(new Error(`${errorMessage}: <Variable name="${name}"/> node is not a value node.`));

                    const value = variableNode.firstChild.nodeValue;

                    if (!value)
                        return reject(new Error(`${errorMessage}: missing value for <Variable name="${name}" /> node.`));

                    let variable = variables[name];

                    if (!variable)
                        return reject(new Error(`${errorMessage}: definition node missing for variable [${name}].`));

                    if (variable.defaultValue)
                        return reject(new Error(`${errorMessage}: duplicate default value for variable [${name}].`));

                    variable.defaultValue = value;
                }

                for (const name in variables) {
                    const variable = variables[name];

                    if (!variable.defaultValue)
                        return reject(new Error(`${errorMessage}: missing default value for variable [${name}].`));
                }

                return resolve({ doc: doc, definitions: variables });

            } catch (err) {

                winston.error(err);
                return reject(new Error(`${errorMessage}: failed to parse file: ${err.message}`));
            }

        }).catch(err => {

            winston.error(err);
            return reject(new Error(`${errorMessage}: failed to read file: ${err.message}`));

        });
    });

}

/**
 * Извлечь значения по-умолчанию для переменных.
 * @param {Object.<string, VariableDef>} definitions - Словарь определений переменных.
 * @returns {Object.<string, string>} - Словарь значений по-умолчанию для переменных.
 */
function ExtractDefaultValues(definitions) {

    const values = {};

    for (const name in definitions) {

        let def = definitions[name];
        values[name] = def.defaultValue;

    }

    return values;
}

/**
 * Удалить из заданного словаря значений те значения, которые удовлетворяют заданному предикату.
 * @param {Object.<string, string>} values - Словарь значений переменных.
 * @param {Object.<string, VariableDef>} definitions - Словарь определений переменных.
 * @param {function(VariableDef):boolean} predicate - Предиката на удаление значения.
 */
function RemoveValuesWhere(values, definitions, predicate) {

    const names = Object.keys(values);
    for (let i = 0; i < names.length; i++) {

        const name = names[i];
        let def = definitions[name];

        if (!predicate(def)) continue;
        delete values[name];
    }

}

/**
 * Выполнить сохранение заданного набора переменных в файл в формате .INI.
 * @param {Object.<string, string>} values - Словарь значений переменных.
 * @param {Object.<string, VariableDef>} definitions - Словарь определений переменных.
 * @param {string} outFilePath - Путь до выходного файла.
 * @param {Object} [options] - Опции.
 * @param {boolean} [options.overwrite] - Признак необходимости перезаписи выходного файла при его наличии.
 * @param {boolean} [options.eol] - Строка, задающая окончания строк.
 * @param {string[]} [options.new] - Массив имен новых переменных.
 * @return {Promise}
 */
function SaveValuesIni(values, definitions, outFilePath, options) {

    const errorMessage = `Failed to save variables values to [${outFilePath}]`;

    options = options || {};
    const eol = (options.eol || '\r\n').toString();
    let overwrite = true;
    if (options.overwrite !== undefined)
        overwrite = false || options.overwrite;

    const newNames = options.new || [];

    return new Promise((resolve, reject) => {

        const outDir = path.dirname(outFilePath);

        fs.ensureDir(outDir).then(() => {

            const sections = {};
            const rootVars = {};

            for (var varName in values) {

                const definition = definitions[varName];
                const value = values[varName];

                // Если в имени переменной нет точки - выносим ее в корневые переменные.
                const dotIndex = varName.indexOf('.');
                if (dotIndex < 1) {

                    rootVars[varName] = {
                        definition: definition,
                        value: value
                    };
                    continue;
                }

                // Определяем имя секции и имя переменной в рамках секции.
                const sectionName = varName.substr(0, dotIndex);

                // Создаем секцию, если встретили ее впервые.
                let section = sections[sectionName];
                if (!section) {
                    section = {};
                    sections[sectionName] = section;
                }

                section[varName] = {
                    definition: definition,
                    value: value
                };

            }

            // Создаем поток для записи в него.
            const outStream = fs.createWriteStream(outFilePath, {
                flags: overwrite ? 'w' : 'wx',
                encoding: 'utf-8'
            });

            // При ошибке отклоняем обещание.
            outStream.on('error', err => {

                winston.error(err);
                return reject(new Error(`${errorMessage}: failed to write to file: ${err.message}`));

            });

            // Записываем переменные, не имеющие секции.
            for (var varName in rootVars) {

                const container = rootVars[varName];
                const definition = container.definition;
                const value = container.value;

                // Нет значения для переменной.
                if (!value) {
                    outStream.end();
                    return reject(new Error(`${errorMessage}: missing value for variable [${varName}].`));
                }

                // Прогоняем имя и значение переменной через функцию, добавляющую escaping при необходимости.
                const nameToWrite = SafeIniString(varName);
                const valueToWrite = SafeIniString(value);

                if (definition) {

                    // Если переменная новая - добавляем комментарий.
                    if (newNames.includes(definition.name)) {
                        outStream.write('; !!! NEW !!!');
                        outStream.write(eol);
                    }

                    // Описание переменной как комментарий.
                    outStream.write('; ');
                    if (definition.kind === VariableKinds.Advanced)
                        outStream.write('[ADVANCED] ');
                    outStream.write(definition.description);
                    outStream.write(eol);

                } else {

                    outStream.write('; !!! DEPRECATED !!!');
                    outStream.write(eol);
                    outStream.write(';');
                }

                // Имя и значение переменной.
                outStream.write(nameToWrite);
                outStream.write(' = ');
                outStream.write(valueToWrite);
                outStream.write(eol);
                outStream.write(eol);
            }

            // Записываем переменные в рамках секций.
            var isFirstSection = true;
            for (var sectionName in sections) {

                if (isFirstSection) {

                    isFirstSection = false;

                } else {

                    // Новые строки при начале новой секции.
                    outStream.write(eol);
                    outStream.write(eol);
                    outStream.write(eol);
                    outStream.write(eol);
                    outStream.write(eol);
                    outStream.write(eol);
                }

                // Имя секции.
                outStream.write('[');
                outStream.write(sectionName);
                outStream.write(']');
                outStream.write(eol);
                outStream.write(eol);

                const section = sections[sectionName];

                for (let varName in section) {

                    const container = section[varName];
                    const definition = container.definition;
                    const value = container.value;

                    if (!value) {
                        outStream.end();
                        return reject(new Error(`${errorMessage}: missing value for variable [${varName}].`));
                    }

                    // Прогоняем имя и значение переменной через функцию, добавляющую escaping при необходимости.
                    const nameToWrite = SafeIniString(varName);
                    const valueToWrite = SafeIniString(value);

                    if (definition) {

                        // Если переменная новая - добавляем комментарий.
                        if (newNames.includes(definition.name)) {
                            outStream.write('; !!! NEW !!!');
                            outStream.write(eol);
                        }

                        // Описание переменной как комментарий.
                        outStream.write('; ');
                        if (definition.kind === VariableKinds.Advanced)
                            outStream.write('[ADVANCED] ');
                        outStream.write(definition.description);
                        outStream.write(eol);

                    } else {

                        outStream.write('; !!! DEPRECATED !!!');
                        outStream.write(eol);
                        outStream.write(';');
                    }

                    // Имя и значение переменной.
                    outStream.write(nameToWrite);
                    outStream.write(' = ');
                    outStream.write(valueToWrite);
                    outStream.write(eol);
                    outStream.write(eol);
                }
            }

            outStream.end();

            // Выполняем обещание после полного закрытия файла.
            outStream.on('close', resolve);

        }).catch(err => ErrorAndReject(reject, `${errorMessage}: failed to ensure dir at [${outDir}]`));

    });
}

/**
 * Выполнить объединение переменных, разделенных по секциям.
 * @param {Object.<string, any>} iniValues - Словарь, полученный в результате персинга INI-файла.
 * @returns {Object.<string, string>} - Словарь значений переменных. 
 */
function CombineSections(iniValues) {

    const values = {};

    for (let key1 in iniValues) {

        const value1 = iniValues[key1];
        const typeOfValue1 = typeof value1;

        switch (typeOfValue1) {

            // Строка - значит переменная без секции.
            case 'string': {
                values[key1] = value1;
                continue;
            }

            case 'boolean': {
                values[key1] = value1.toString();
                continue;
            }

            case 'object': {

                // null - значит переменная без секции.
                if (value1 == null) {
                    values[key1] = '';
                    continue;
                }

                // Объект - значит секция.
                for (let key2 in value1) {

                    const value2 = value1[key2];

                    // null - значит пустое значение.
                    if (value2 === null) {
                        values[key2] = '';
                        continue;
                    }

                    // Строка - значит нормальное значение.
                    if (typeof value2 === 'string') {
                        values[key2] = value2;
                        continue;
                    }

                    // Логическое значение - значит нормальное значение.
                    if (typeof value2 === 'boolean') {
                        values[key2] = value2.toString();
                        continue;
                    }

                    // Все остальное - ошибка.
                    throw new Error(`Encountered value [${value2}] of unsupported type [${typeof value2}] for var [${key2}] in section ${key1}.`)
                }

                continue;
            }

            default:
                throw new Error(`Encountered value [${value1}] of unsupported type [${typeOfValue1}] for variable [${key1}].`)
        }
    }

    return values;
}

/**
 * Выполнить загрузку значений переменных из файла в формате .INI.
 * @param {string} filePath - Путь до файла в формате .INI для загрузки.
 * @returns {Promise<Object.<string, string>>} - Строковый словарь значений переменных.
 */
function LoadValuesIni(filePath) {

    const errorMessage = `Failed to load ini-vars from [${filePath}]`;

    return new Promise((resolve, reject) => {

        fs.readFile(filePath, 'utf-8').then(data => {

            // Выполняем разбор ini-файла.
            let rawVars = null;
            try {

                const parser = new IniParser(IniParserOptions);
                rawVars = parser.parse(data);

            } catch (err) {

                winston.error(err);
                return reject(new Error(`${errorMessage}: failed to parse ini-format: ${err.message}`));
            }
            if (!rawVars) return reject(new Error(`${errorMessage}: failed to parse ini-format`));

            // Выполняем преобразование в плоский формат.
            let flatVars = null;
            try { flatVars = CombineSections(rawVars); } catch (err) {

                winston.error(err);
                return reject(new Error(`${errorMessage}: failed to flatten raw ini-vars: ${err.message}`));
            }

            // Успешно завершаемся.
            return resolve(flatVars);

        }).catch(err => {

            winston.error(err);
            return reject(new Error(`${errorMessage}: failed to read file: ${err.message}`));

        });
    });
}

/**
 * Выполнить проверку соответствия набора значений переменных определениям по принципу совпадения ключей.
 * @param {Object.<string, string>} values - Словарь значений переменных.
 * @param {Object.<string, VariableDef>} definitions - Словарь определений переменных.
 * @returns {{missingEssential: string[], missingAdvanced: string[], extra: string[]}} - Результат проверки.
 */
function MatchToDefinitions(values, definitions) {

    // Мономорфный результат.
    const res = {

        missingEssential: /** @type { string[] } */([]),
        missingAdvanced: /** @type { string[] } */([]),
        extra: /** @type { string[] } */([])

    };

    // Изначально считаем, что все пропущеною
    const missing = Object.assign({}, definitions);

    // Проходим по заданным переменным.
    for (const name in values) {

        const definition = missing[name];

        // Не нашли определения - лишняя переменная.
        if (!definition) {
            res.extra.push(name);
            continue;
        }

        // Нашли определение - удаляем его из пропущенных.
        delete missing[name];
    }

    // Раскидываем пропущенные переменные по категориям.
    for (const name in missing) {

        const def = missing[name];

        switch (def.kind) {

            case VariableKinds.Essential:
                res.missingEssential.push(name);
                break;

            case VariableKinds.Advanced:
                res.missingAdvanced.push(name);
                break;

        }

    }

    return res;
}

/**
 * Выполнить применение значений переменных к исходному XML-документу.
 * @param {Object.<string, string>} values - Словарь значений переменных.
 * @param {Document} doc - XML-документ для обновления.
 * @returns {Promise}
 */
function ApplyValues(values, doc, outFilePath) {

    const errorMessage = `Failed to apply variables values and save to [${outFilePath}]`;

    return new Promise((resolve, reject) => {

        // Проходим по значениям переменных.
        const variableElements = /** @type {Element[]} */ (xpath.select('/Settings/Configuration/Variable', doc));
        for (var variableNode of variableElements) {

            const name = variableNode.getAttribute('name');

            if (!name)
                return reject(new Error(`${errorMessage}: missing 'name' attribute for <Variable/> node.`));

            const newValue = values[name];

            if (!newValue)
                continue;

            variableNode.removeChild(variableNode.firstChild);
            variableNode.appendChild(doc.createTextNode(newValue));
        }

        const serializer = new XMLSerializer();

        const outDir = path.dirname(outFilePath);

        fs.ensureDir(outDir).then(() => {

            fs.writeFile(outFilePath, serializer.serializeToString(doc))
                .then(resolve)
                .catch(err => ErrorAndReject(reject, `${errorMessage}: failed to write file`, err));

        }).catch(err => ErrorAndReject(reject, `${errorMessage}: failed to ensure output dir at [${outDir}]`, err));

    });

}

/**
 * Выполнить запуск валидатора переменных.
 * @param {Paths} paths - контейнер путей
 * @param {string} varsFile - путь до файла переменных
 * @returns {Promise}
 */
function RunConfigValidatorConsoleVerbose(paths, varsFile) {

    return new Promise((resolve, reject) => {


        Spawn(paths.dotnetExeFile, [
            paths.varsValidatorDllFile,
            varsFile
        ]).then(res => {

            if (res.code === 0) return resolve();

            const m = `ERROR: Invalid config file at [${paths.configIniFile}]:`
            winston.error(m + 'non-zero return code from validator');
            console.log(m);
            console.log(res.stdout);

            return reject(new Error(m + 'non-zero return code from validator'))

        }).catch(err => ErrorAndReject(reject, `Failed to run config vars validator at [${paths.varsValidatorDllFile}]`, err));

    });
}

/**
 * Выполнить запуск валидатора переменных.
 * @param {Paths} paths - контейнер путей
 * @param {string} varsFile - путь до файла переменных
 * @returns {Promise}
 */
function RunConfigValidatorConsole(paths, varsFile) {

    return new Promise((resolve, reject) => {


        Spawn(paths.dotnetExeFile, [
            paths.varsValidatorDllFile,
            varsFile
        ]).then(res => {

            if (res.code === 0) return resolve();

            const m = `ERROR: Invalid config file at [${paths.configIniFile}]`
            winston.error(m + ': non-zero return code from validator');
            console.log(m);

            return reject(new Error(m + ': non-zero return code from validator'))

        }).catch(err => ErrorAndReject(reject, `Failed to run config vars validator at [${paths.varsValidatorDllFile}]`, err));

    });
}


// ------------------------------------------------------------------------------ //
// ------------------------------------------------------------------------------ //
// ---------------------------------- ЭКСПОРТЫ ---------------------------------- //
// ------------------------------------------------------------------------------ //
// ------------------------------------------------------------------------------ //

module.exports = {

    /**
     * Реализация команды создания конфигурационного файла значений переменных по-умолчанию.
     * @param {string} valuesPath - путь до файла значений переменных.
     * @param {string} definitionsPath - путь до файла определений переменных.
     * @param {boolean} overwrite - признак перезаписи файла значений при его наличии.
     * @param {boolean} includeAdvanced - признак включения в конфиг в том числе advanced-переменных.
     * @returns {Promise}
     */
    CreateDefaultConfigCommand(valuesPath, definitionsPath, overwrite, includeAdvanced) {

        return new Promise((resolve, reject) => {

            // Проверяем файл на существование.
            fs.pathExists(valuesPath).then(exists => {

                // Не разрешаем перезаписывать файл без соответствующей опции.
                if (exists && !overwrite) {

                    const m = `FAIL: Failed to create default config at [${valuesPath}]: file already exists. Consider using --overwrite option.`;
                    winston.error(m);
                    console.log(m);
                    return reject(new Error(m));
                }

                // Грузим определения.
                LoadVarsDefinitionXml(definitionsPath).then(res => {

                    // Фильтруем определения переменных по типу.
                    const definitions = res.definitions;
                    for (const name in definitions) {

                        const def = definitions[name];
                        switch (def.kind) {

                            case VariableKinds.Essential:
                                break;

                            case VariableKinds.Advanced:
                                if (!includeAdvanced) delete definitions[name];
                                break;

                            case VariableKinds.Hidden:
                                delete definitions[name];
                                break;
                        }

                    }

                    // Берем значения по-умолчанию.
                    const defaultValues = ExtractDefaultValues(definitions);

                    // Сохраняем значения как .INI.
                    return SaveValuesIni(defaultValues, definitions, valuesPath, {

                        overwrite: overwrite

                    });

                }).then(() => {

                    const m = `SUCCESS: Created default config at [${valuesPath}]`;
                    winston.info(m);
                    console.log(m);
                    return resolve();

                }).catch(err => {

                    winston.error(err);

                    const m = `FAIL: Failed to create default config. See log for details`;
                    winston.error(m);
                    console.log(m);
                    return reject(new Error(m));

                });

            }).catch(err => {

                winston.error(err);

                const m = `FAIL: Failed to create default config. See log for details`;
                winston.error(m);
                console.log(m);
                return reject(new Error(m));

            });
        });
    },

    /**
     * Реализация команды выполнения проверки корректности файла значений переменных.
     * @param {string} valuesPath - путь до файла значений переменных.
     * @param {string} definitionsPath - путь до файла определений переменных.
     * @param {Paths} paths - контейнер путей.
     * @param {boolean} requireAdvanced - признак необходимости наличия всех advanced-переменных.
     * @returns {Promise}
     */
    CheckConfigCommand(valuesPath, definitionsPath, paths, requireAdvanced) {

        const errorMessage = 'Failed to check config';

        return new Promise((resolve, reject) => {

            // Проверяем файл на существование.
            fs.pathExists(valuesPath).then(exists => {

                // Проверяем, что файл существует.
                if (!exists) {

                    const m = `FAIL: Failed to check config at [${valuesPath}]: file not found`;
                    winston.error(m);
                    console.log(m);
                    return reject(new Error(m));
                }

                // Грузим определения и значения.
                Promise.all([

                    LoadVarsDefinitionXml(definitionsPath),
                    LoadValuesIni(valuesPath)

                ]).then(results => {

                    const { definitions, doc } = results[0];
                    const values = results[1];

                    // Выполняем сравнение имен переменных.
                    const res = MatchToDefinitions(values, definitions);

                    // Проверяем результат сравнения с определениями.
                    const invalidCount = res.missingEssential.length + res.extra.length + (requireAdvanced ? res.missingAdvanced.length : 0);
                    if (invalidCount) {

                        let out = `FAIL: Invalid config at [${valuesPath}]${os.EOL}`;

                        if (res.missingEssential.length > 0) {

                            out += `${os.EOL}Missing essential variables:${os.EOL}`
                            for (let i = 0; i < res.missingEssential.length; i++) {
                                out += `${os.EOL}  ${i + 1}. ${res.missingEssential[i]} `
                            }
                            out += os.EOL;

                        }

                        if (res.missingAdvanced.length > 0) {

                            out += `${os.EOL}Missing advanced variables:${os.EOL}`
                            for (let i = 0; i < res.missingAdvanced.length; i++) {
                                out += `${os.EOL}  ${i + 1}. ${res.missingAdvanced[i]} `
                            }
                            out += os.EOL;

                        }

                        if (res.extra.length > 0) {

                            out += `${os.EOL}Unknown variables:${os.EOL}`
                            for (let i = 0; i < res.extra.length; i++) {
                                out += `${os.EOL}  ${i + 1}. ${res.extra[i]} `
                            }
                            out += os.EOL;

                        }

                        winston.error(out);
                        console.log(out);
                        return reject(new Error(out));
                    }

                    const tempVarsFile = path.join(paths.tempDir, RandomString() + '.xml');

                    ApplyValues(values, doc, tempVarsFile)
                        .then(() => {

                            RunConfigValidatorConsoleVerbose(paths, tempVarsFile).then(() => {

                                const m = `INFO: Valid config at [${valuesPath}]`;
                                winston.info(m);
                                console.log(m);
                                return resolve();

                            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, err));

                        }).catch(err => ErrorAndRejectConsole(reject, errorMessage, err));

                }).catch(err => ErrorAndRejectConsole(reject, errorMessage, err));

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, err));

        });
    },

    /**
     * Реализация команды выполнения апгрейда файла значений переменных.
     * @param {string} valuesPath - путь до файла значений переменных.
     * @param {string} definitionsPath - путь до файла определений переменных.
     * @param {boolean} overwrite - признак перезаписи файла значений при его наличии.
     * @param {boolean} includeAdvanced - признак включения помимо основных еще и advanced-переменных.
     * @returns {Promise}
     */
    UpgradeConfigCommand(valuesPath, definitionsPath, overwrite, includeAdvanced) {

        return new Promise((resolve, reject) => {

            // Проверяем файл на существование.
            fs.pathExists(valuesPath).then(exists => {

                // Проверяем, что файл существует.
                if (!exists) {

                    const m = `FAIL: Failed to upgrade config at [${valuesPath}]: file not found`;
                    winston.error(m);
                    console.log(m);
                    return reject(new Error(m));
                }

                // Грузим определения и значения.
                Promise.all([

                    LoadVarsDefinitionXml(definitionsPath),
                    LoadValuesIni(valuesPath)

                ]).then(results => {

                    const { definitions } = results[0];
                    const values = results[1];

                    // Выполняем сравнение имен переменных.
                    const res = MatchToDefinitions(values, definitions);

                    // Если набор переменных совпал - нечего апгрейдить.
                    const invalidCount = res.missingEssential.length + res.extra.length + (includeAdvanced ? res.missingAdvanced.length : 0);
                    if (invalidCount < 1 && !overwrite) {

                        const m = `SUCCESS: Config at [${valuesPath}] is up-to-date. Nothing to upgrade`;
                        winston.info(m);
                        console.log(m);
                        return resolve();

                    }

                    // Дополняем набор значений переменных значениями по-умолчанию.
                    const newNames = [];

                    for (const name of res.missingEssential) {

                        values[name] = definitions[name].defaultValue;
                        newNames.push(name);

                    }

                    if (includeAdvanced) {

                        for (const name of res.missingAdvanced) {

                            values[name] = definitions[name].defaultValue;
                            newNames.push(name);

                        }

                    }

                    SaveValuesIni(values, definitions, valuesPath, {

                        overwrite: true,
                        new: newNames

                    }).then(() => {

                        const m = `SUCCESS: Upgraded config at [${valuesPath}]: ${res.missingEssential.length} essential added, ${res.missingAdvanced.length} advanced added, ${res.extra.length} removed`;
                        winston.info(m);
                        console.log(m);
                        return resolve();

                    }).catch(err => {

                        winston.error(err);

                        const m = `FAIL: Failed to upgrade config. See log for details`;
                        winston.error(m);
                        console.log(m);
                        return reject(new Error(m));

                    });


                }).catch(err => {

                    winston.error(err);

                    const m = `FAIL: Failed to upgrade config. See log for details`;
                    winston.error(m);
                    console.log(m);
                    return reject(new Error(m));

                });


            }).catch(err => {

                winston.error(err);

                const m = `FAIL: Failed to upgrade config. See log for details`;
                winston.error(m);
                console.log(m);
                return reject(new Error(m));

            });
        });

    },

    /**
     * Выполнить открытие, валидацию и преобразование INI-файла переменных в XML.
     * @param {String} valuesPath - путь до файла значений переменных.
     * @param {*} definitionsPath - путь до файла определений переменных.
     * @param {Paths} paths - контейнер путей.
     * @returns {Promise}
     */
    TransformIniToXml(valuesPath, definitionsPath, outPath, paths) {

        const errorMessage = 'Failed to transform INI-config file to XML';
        return new Promise((resolve, reject) => {

            Promise.all([

                LoadValuesIni(valuesPath),
                LoadVarsDefinitionXml(definitionsPath)

            ]).then(arr => {

                const values = arr[0];
                const { definitions, doc } = arr[1];

                const res = MatchToDefinitions(values, definitions);

                // !!! Учитываем только пропущенные основные переменные !!! 
                const invalidCount = res.missingEssential.length + res.extra.length;
                if (invalidCount > 0) return ErrorAndReject(reject, errorMessage + ': invalid ini file content. Missing essential: ' + res.missingEssential.join(";"));

                ApplyValues(values, doc, outPath)
                    .then(() => {

                        RunConfigValidatorConsole(paths, outPath).then(resolve).catch(err => ErrorAndReject(reject, errorMessage + ': invalid variable values detected', err));

                    })
                    .catch(err => ErrorAndReject(reject, errorMessage + ': failed to apply values', err));

            }).catch(err => ErrorAndReject(reject, errorMessage + ': failed to load either of files', err));

        });

    }

}