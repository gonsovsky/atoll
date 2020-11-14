//@ts-check
const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const IniParser = require('./ini-parser');
const winston = require('winston');
const { pd } = require('pretty-data');
const xpath = require('xpath');
const { DOMParser, XMLSerializer, DOMImplementation } = require('xmldom');
const { ErrorAndReject, ErrorAndRejectConsole, InfoAndResolve, InfoAndResolveConsole, SafeIniString, IsValidVersion } = require('./helpers');

const MsBuildNamespace = 'http://schemas.microsoft.com/developer/msbuild/2003'
const xselect = xpath.useNamespaces({ "msb": MsBuildNamespace });

/** Регулярное выражение для разбора строки зависимости кубышки. */
const CoobDependencyRegex = /(?<coobId>[^;]+)\.(?<coobVersion>\d+\.\d+\.\d+)/;

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


/** Выполнить чтение версий для заданных имен ролей из файла. */
function ReadVersionsFile(filePath) {

    const errorMessage = `Failed to read version file at [${filePath}]`;

    return new Promise((resolve, reject) => {

        fs.readFile(filePath, { encoding: 'utf-8' }).then(data => {

            let versions = /** @type {Object.<string, any>} */(null);
            try {

                const parser = new IniParser(IniParserOptions);
                versions = parser.parse(data);

            } catch (err) {

                return ErrorAndReject(reject, `${errorMessage}: error parsing file`, err);
            }

            for (let key in versions) {

                const value = versions[key];

                if (typeof value !== 'string')
                    return ErrorAndReject(reject, `${errorMessage}: versions file is not flat: encountered root value of type [${typeof value}]`);
            }

            return InfoAndResolve(resolve, `Successfully read version file at [${filePath}]: ${os.EOL}${os.EOL}${pd.json(JSON.stringify(versions))}`, versions);

        }).catch(err => ErrorAndReject(reject, `${errorMessage}: error reading file`, err));

    });
}

/**
 * Выполнить сохранение словаря версий в заданный файл.
 * @param {string} filePath 
 * @param {Object.<string, string>} versions - Словарь версий для сохранения.
 * @param {Object.<string, string>} required - Словарь имя-описание требуемых версий.
 * @param {Object} [options] - Опции.
 * @param {boolean} [options.overwrite] - Признак необходимости перезаписи выходного файла при его наличии.
 * @param {boolean} [options.eol] - Строка, задающая окончания строк.
 */
function SaveVersionsFile(filePath, versions, required, options) {

    const errorMessage = `Failed to save version file to [${filePath}]`;

    options = options || {};
    const eol = (options.eol || '\r\n').toString();
    let overwrite = true;
    if (options.overwrite !== undefined)
        overwrite = false || options.overwrite;

    return new Promise((resolve, reject) => {

        // Создаем поток для записи в него.
        const outStream = fs.createWriteStream(filePath, {
            flags: overwrite ? 'w' : 'wx',
            encoding: 'utf-8'
        });

        // При ошибке отклоняем обещание.
        outStream.on('error', err => ErrorAndReject(reject, `${errorMessage}: failed to write to file`, err));

        // Записываем версии для ролей, не имеющих определения.
        for (var roleName in versions) {

            const version = versions[roleName];
            const description = required[roleName];

            // Прогоняем имя и значение переменной через функцию, добавляющую escaping при необходимости.
            const roleNameToWrite = SafeIniString(roleName);
            const versionToWrite = SafeIniString(version);

            if (!description) {

                // Описание роли как комментарий.
                outStream.write('; !!! DEPRECATED !!!');
                outStream.write(eol);
                outStream.write(';');

            } else {

                // Описание роли как комментарий.
                outStream.write('; ');
                outStream.write(description);
                outStream.write(eol);

            }

            // Имя и значение переменной.
            outStream.write(roleNameToWrite);
            outStream.write(' = ');
            outStream.write(versionToWrite);
            outStream.write(eol);
            outStream.write(eol);
        }

        outStream.end();

        // Выполняем обещание после полного закрытия файла.
        outStream.on('close', resolve);

    });
}

/**
 * Выполнить создание словаря версий для всех известных ролей.
 * @param {string} version - единое значение версии.
 * @param {Object.<string, any>} required - словарь определений ролей.
 */
function CreateKnownRoleVersions(version, required) {

    const res = {};
    for (let roleName in required) {
        res[roleName] = version;
    }
    return res;
}

/**
 * Создать строковое представление версии для сегодняшнего дня.
 * @returns {string}
 */
function GetTodayVersion() {

    const now = new Date();
    return `${now.getFullYear().toString().slice(-2)}.${now.getMonth() + 1}.${now.getDate()}`;

}

/**
 * Выполнить проверку корректности словаря версий.
 * @param {Object.<string, string>} versions - Словарь версий для проверки.
 * @returns {{success: boolean, extra: string[], missing:string[], invalid:string[]}}
 */
function CheckVersions(versions, required) {

    const extra = [];
    const missing = Object.keys(required);
    const invalid = [];

    for (let roleName in versions) {

        const roleVersion = versions[roleName];

        if (typeof roleVersion !== 'string' || !IsValidVersion(roleVersion))
            invalid.push(roleName);

        const index = missing.indexOf(roleName);
        if (index < 0) {
            extra.push(roleName);
            continue;
        }

        missing.splice(index, 1)
    }

    return {
        success: (extra.length + missing.length + invalid.length) < 1,
        extra: extra,
        missing: missing,
        invalid: invalid
    }
}

// ------------------------------------------------------------------------------ //
// ------------------------------------------------------------------------------ //
// ---------------------------------- ЭКСПОРТЫ ---------------------------------- //
// ------------------------------------------------------------------------------ //
// ------------------------------------------------------------------------------ //

module.exports = {

    /**
     * Реализация команды создания файла версий по-умолчанию.
     * @param {string} versionsPath - путь до создаваемого файла версий.
     * @param {Object.<string, string>} requiredVersions - словарь имя-описание всех требуемых версий.
     * @param {boolean} overwrite - признак перезаписи файла версий при его наличии.
     * @returns {Promise}
     */
    CreateDefaultVersionsCommand(versionsPath, requiredVersions, overwrite) {

        const errorMessage = `Failed to create default versions file at [${versionsPath}]`;

        return new Promise((resolve, reject) => {

            // Проверяем файл на существование.
            fs.pathExists(versionsPath).then(exists => {

                // Проверяем, что файл существует.
                if (exists && !overwrite) return ErrorAndRejectConsole(reject, errorMessage + ': file already exists. Consider using --overwrite option');

                // Сохраняем файл.
                SaveVersionsFile(versionsPath, CreateKnownRoleVersions(GetTodayVersion(), requiredVersions), requiredVersions, { overwrite: overwrite })
                    .then(() => InfoAndResolveConsole(resolve, `Successfully created default versions file at [${versionsPath}]`))
                    .catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to save file`, err));

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to check if file already exists', err));

        });
    },

    /**
     * Реализация команды создания файла версий с единым значением версии для всех элементов.
     * @param {string} versionsPath - путь до создаваемого файла версий.
     * @param {Object.<string, string>} requiredVersions - словарь имя-описание всех требуемых версий.
     * @param {string} version - единое значение версии.
     * @param {boolean} overwrite - признак перезаписи файла версий при его наличии.
     * @returns {Promise}
     */
    CreateMonoVersionsCommand(versionsPath, requiredVersions, version, overwrite) {

        const errorMessage = `Failed to create mono versions file at [${versionsPath}]`;

        return new Promise((resolve, reject) => {

            // Проверяем файл на существование.
            fs.pathExists(versionsPath).then(exists => {

                // Проверяем, что файл существует.
                if (exists && !overwrite) return ErrorAndRejectConsole(reject, errorMessage + ': file already exists. Consider using --overwrite option');

                // Сохраняем файл.
                SaveVersionsFile(versionsPath, CreateKnownRoleVersions(version, requiredVersions), requiredVersions, { overwrite: overwrite })
                    .then(() => InfoAndResolveConsole(resolve, `Successfully created mono versions file at [${versionsPath}]`))
                    .catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to save file`, err));

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to check if file already exists', err));

        });
    },

    /**
     * Реализация команды проверки корректности файла версий.
     * @param {string} versionsPath - путь до создаваемого файла версий.
     * @param {Object.<string, string>} requiredVersions - словарь имя-описание всех требуемых версий.
     * @returns {Promise<Object.<string, string>>}
     */
    CheckVersionsCommand(versionsPath, requiredVersions) {

        const errorMessage = `Failed to check versions file at [${versionsPath}]`;

        return new Promise((resolve, reject) => {

            // Проверяем файл на существование.
            fs.pathExists(versionsPath).then(exists => {

                // Проверяем, что файл существует.
                if (!exists) return ErrorAndRejectConsole(reject, errorMessage + ': file not found');

                ReadVersionsFile(versionsPath).then(versions => {

                    const res = CheckVersions(versions, requiredVersions);
                    if (res.success) return InfoAndResolveConsole(resolve, `Valid version file at [${versionsPath}]`, versions);

                    let out = `Invalid version file at [${versionsPath}] ${os.EOL}`;

                    if (res.missing.length > 0) {

                        out += `${os.EOL}Missing items:${os.EOL}`;
                        for (let i = 0; i < res.missing.length; i++) {
                            out += `${os.EOL}  ${i + 1}. ${res.missing[i]} `;
                        }
                        out += os.EOL;
                    }

                    if (res.extra.length > 0) {

                        out += `${os.EOL}Unknown items:${os.EOL}`
                        for (let i = 0; i < res.extra.length; i++) {
                            out += `${os.EOL}  ${i + 1}. ${res.extra[i]} `;
                        }
                        out += os.EOL;
                    }

                    if (res.invalid.length > 0) {

                        out += `${os.EOL}Invalid value for items:${os.EOL}`;
                        for (let i = 0; i < res.invalid.length; i++) {
                            out += `${os.EOL}  ${i + 1}. ${res.invalid[i]} `;
                        }
                        out += os.EOL;
                    }

                    return ErrorAndRejectConsole(reject, out);

                }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to read versions file', err));

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to check if versions file exists', err));

        });

    },

    /**
     * Реализация команды апгрейда файла версий.
     * @param {string} versionsPath - путь до создаваемого файла версий.
     * @param {Object.<string, string>} requiredVersions - словарь имя-описание всех требуемых версий.
     * @param {boolean} overwrite - признак перезаписи файла версий при его наличии.
     * @returns {Promise<Object.<string, string>>}
     */
    UpgradeVersionsCommand(versionsPath, requiredVersions, overwrite) {

        const errorMessage = `Failed to create upgrade versions file at [${versionsPath}]`;

        return new Promise((resolve, reject) => {

            // Проверяем файл на существование.
            fs.pathExists(versionsPath).then(exists => {

                // Проверяем, что файл существует.
                if (!exists) return ErrorAndRejectConsole(reject, errorMessage + ': file not found');

                ReadVersionsFile(versionsPath).then(versions => {

                    const res = CheckVersions(versions, requiredVersions);
                    if (res.success && !overwrite) return InfoAndResolveConsole(resolve, `Version file at [${versionsPath}] is up-to-date. Nothing to upgrade`, versions);

                    const todayVersion = GetTodayVersion();

                    if (res.missing.length > 0) {

                        for (let i = 0; i < res.missing.length; i++) {
                            versions[res.missing[i]] = todayVersion;
                        }
                    }

                    return SaveVersionsFile(versionsPath, versions, requiredVersions, { overwrite: true })
                        .then(() => InfoAndResolveConsole(resolve, `Upgraded version file at [${versionsPath}]: ${res.missing.length} added, ${res.extra.length} removed`, versions));

                }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to read versions file', err));

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to check if versions file exists', err));

        });
    },

    /**
     * Функция чтения и проверки корректности файла версий (для использования в других командах).
     * @param {string} versionsPath - путь до создаваемого файла версий.
     * @param {Object.<string, string>} requiredVersions - словарь имя-описание всех требуемых версий.
     * @returns {Promise<Object.<string, string>|null>}
     */
    ReadAndCheckVersions(versionsPath, requiredVersions) {

        const errorMessage = `Failed to read and check versions file at [${versionsPath}]`;

        return new Promise((resolve, reject) => {

            ReadVersionsFile(versionsPath).then(versions => {

                // Выполняем проверку файла версий.
                const res = CheckVersions(versions, requiredVersions);

                if (!res.success) return ErrorAndRejectConsole(reject, errorMessage, ': invalid versions file');

                return resolve(versions);

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to read versions file', err));

        });

    },

    /**
     * Выполнить сохранение словаря версий в заданный файл в формате файла переменных.
     * @param {string} outFilePath - Путь до выходного файла.
     * @param {Object.<string, string>} versions - Словарь версий для сохранения.
     */
    SaveRoleVersionsVarsFile(versions, outFilePath) {

        const errorMessage = `Failed to save versions vars file to [${outFilePath}]`;

        return new Promise((resolve, reject) => {

            // Создаем новый XML-документ.
            const dom = new DOMImplementation();
            const doc = dom.createDocument("", null, null);
            
            const settingsElement = doc.createElement("Settings");
            doc.appendChild(settingsElement);

            const definitionElement = doc.createElement("Definition");
            settingsElement.appendChild(definitionElement);

            const configurationElement = doc.createElement("Configuration");
            settingsElement.appendChild(configurationElement);

            // Создаем для каждой роли определение и значение переменной.
            for (var roleName in versions) {

                if (!versions.hasOwnProperty(roleName)) continue;

                let roleNameParts = roleName.split('.');

                let variableName = "Coral.Atoll.";
                for(var part of roleNameParts) {
                    
                    part = part.toLowerCase();
                    part = part.charAt(0).toUpperCase() + part.slice(1);

                    variableName += part;
                    variableName += '.';
                }
                variableName += "RoleVersion";

                const varDefinitionElement = doc.createElement("VariableDefinition");
                varDefinitionElement.setAttribute('name', variableName);
                definitionElement.appendChild(varDefinitionElement);

                const varValueElement = doc.createElement("Variable");
                varValueElement.setAttribute('name', variableName);
                varValueElement.textContent = versions[roleName];
                configurationElement.appendChild(varValueElement);
            }

            // Выполняем сериализацию созданного XML-документа.
            const serializer = new XMLSerializer();
            const outDir = path.dirname(outFilePath);

            fs.ensureDir(outDir).then(() => {

                fs.writeFile(outFilePath, serializer.serializeToString(doc))
                    .then(resolve)
                    .catch(err => ErrorAndReject(reject, `${errorMessage}: failed to write file`, err));

            }).catch(err => ErrorAndReject(reject, `${errorMessage}: failed to ensure output dir at [${outDir}]`, err));

        });

    },

    /**
     * Выполнить чтение описателя кубышки и сохранение версии кубышки и версий ее зависимостей как файла переменных.
     * @param {string} coobPropsFilePath - Путь до файла-описателя кубышки.
     * @returns {Promise<Object.<string, string>>} versions - Словарь версий кубышек.
     */
    ReadCoobVersions(coobPropsFilePath) {

        const errorMessage = `Failed to read coob props file at '${coobPropsFilePath}'`;

        return new Promise((resolve, reject) => {

            if (!coobPropsFilePath) return reject(new Error('Argument missing: coobPropsFilePath'));
    
            // Читаем файл.
            fs.readFile(coobPropsFilePath, 'utf-8').then((data) => {
    
                const result = /** @type {Object.<string, string>} */({});

                // Синхронно разбираем XML.
                const doc = new DOMParser().parseFromString(data, 'application/xml');

                // Базовые обязательные атрибуты кубышки.
                const coobId = (/** @type {HTMLElement} */ (xselect("//msb:Project/msb:PropertyGroup/msb:CoobId", doc, /*single*/ true))).textContent;
                const coobVersion = (/** @type {HTMLElement} */ (xselect("//msb:Project/msb:PropertyGroup/msb:CoobVersion", doc, /*single*/ true))).textContent;
                
                // Заносим в результат версию самой кубышки.
                result[coobId.toLowerCase()] = coobVersion;

                // Выбираем все зависимости.
                const dependencyAttributes = /** @type {Attr[]} */(xselect("//msb:Project/msb:ItemGroup/msb:CoobReference/@Include", doc));
                for (var attr of dependencyAttributes) {
                    
                    let execResult = CoobDependencyRegex.exec(attr.value);
                    const dependencyId = execResult.groups["coobId"];
                    const dependencyVersion = execResult.groups["coobVersion"];
                    
                    // Заносим в результат версию зависимости.
                    result[dependencyId.toLowerCase()] = dependencyVersion;
                }

                // Завершаемся с успешным результатом.
                resolve(result);
    
            }).catch(err => ErrorAndReject(reject, `${errorMessage}: failed to read file.`, err));
    
        });
    
    },

    /**
     * Выполнить сохранение словаря версий кубышек в заданный файл в формате файла переменных.
     * @param {string} outFilePath - Путь до выходного файла.
     * @param {Object.<string, string>} versions - Словарь версий для сохранения.
     */
    SaveCoobVersionsVarsFile(versions, outFilePath) {

        const errorMessage = `Failed to save coob versions vars file to [${outFilePath}]`;

        return new Promise((resolve, reject) => {

            // Создаем новый XML-документ.
            const dom = new DOMImplementation();
            const doc = dom.createDocument("", null, null);
            
            const settingsElement = doc.createElement("Settings");
            doc.appendChild(settingsElement);

            const definitionElement = doc.createElement("Definition");
            settingsElement.appendChild(definitionElement);

            const configurationElement = doc.createElement("Configuration");
            settingsElement.appendChild(configurationElement);

            // Создаем для каждой роли определение и значение переменной.
            for (var coobName in versions) {

                if (!versions.hasOwnProperty(coobName)) continue;

                let coobNameParts = coobName.split('.');

                let variableName = "";
                for(var part of coobNameParts) {
                    
                    part = part.toLowerCase();
                    part = part.charAt(0).toUpperCase() + part.slice(1);

                    variableName += part;
                    variableName += '.';
                }
                variableName += "CoobVersion";

                const varDefinitionElement = doc.createElement("VariableDefinition");
                varDefinitionElement.setAttribute('name', variableName);
                definitionElement.appendChild(varDefinitionElement);

                const varValueElement = doc.createElement("Variable");
                varValueElement.setAttribute('name', variableName);
                varValueElement.textContent = versions[coobName];
                configurationElement.appendChild(varValueElement);
            }

            // Выполняем сериализацию созданного XML-документа.
            const serializer = new XMLSerializer();
            const outDir = path.dirname(outFilePath);

            fs.ensureDir(outDir).then(() => {

                fs.writeFile(outFilePath, serializer.serializeToString(doc))
                    .then(resolve)
                    .catch(err => ErrorAndReject(reject, `${errorMessage}: failed to write file`, err));

            }).catch(err => ErrorAndReject(reject, `${errorMessage}: failed to ensure output dir at [${outDir}]`, err));

        });

    },

}