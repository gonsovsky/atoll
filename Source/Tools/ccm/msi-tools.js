//@ts-check
const path = require('path');
const readline = require('readline');

const { DOMParser, XMLSerializer } = require('xmldom');
const xpath = require('xpath');
const { pd } = require('pretty-data');
const fs = require('fs-extra');
const winston = require('winston');

const { ReadAndCheckVersions } = require('./version-tools');
const { Paths } = require('./paths');

const { RandomString, Spawn, ErrorAndReject, ErrorAndRejectConsole, InfoAndResolve, InfoAndResolveConsole } = require('./helpers');

const WixNamespace = 'http://schemas.microsoft.com/wix/2006/wi'
const xselect = xpath.useNamespaces({ "wi": WixNamespace });


/** Выполнить чтение опционального файла исключений для компонент.
 * @param {string} filePath путь до файла с исключениями
 * @returns {Promise<{lines:string[], exists: boolean}>}
 */
function ReadExlusionsFile(filePath) {

    return new Promise((resolve, reject) => {

        if (!filePath) return reject(new Error('Argument missing: filePath'));

        const errorMessage = `Failed to read exclusions file at [${filePath}]`;

        fs.pathExists(filePath).then((exists) => {

            if (!exists) {

                winston.info(`No exclusions file found at [${filePath}]`);
                return resolve({ lines: [], exists: false });

            }

            try {

                var lines = [];
                var streamEnded = false;

                var stream = fs.createReadStream(filePath);
                stream.on('end', () => { streamEnded = true; });

                readline.createInterface(
                    {
                        input: stream,
                        terminal: false
                    })
                    .on('line', (line) => {
                        line = line.trim();
                        if (line.length < 1 || line.startsWith('#')) return;
                        lines.push(line);
                    })
                    .on('close', () => {

                        if (!streamEnded)
                            return reject(new Error(`${errorMessage}: lines ended before close`));

                        winston.info(`Successfully read ${lines.length} exclusions from [${filePath}].`);
                        return resolve({ lines: lines, exists: true });
                    });

            } catch (err) {

                winston.error(err);
                return reject(new Error(`${errorMessage}: failed to open stream or create interface: ${err.message}`));

            }


        }).catch((err) => {

            winston.error(err);
            return reject(new Error(`${errorMessage}: failed to check if file exists: ${err.message}`));

        });

    });

}

/** Выполнить исключение заданных компонент из авто-скомпонованного файла.
 * @param {{from: string, to: string, what: string[]}} options опции исключения.
 * @returns {Promise}
 */
function ExcludeComponents(options) {

    return new Promise((resolve, reject) => {

        if (!options) return reject(new Error('Argument missing: options'));

        var inFilePath = options.from;
        if (!inFilePath) return reject(new Error('Argument missing: options.from'));

        var outFilePath = options.to;
        if (!outFilePath) return reject(new Error('Argument missing: options.to'));

        var fileSources = options.what;
        if (!fileSources) return reject(new Error('Argument missing: options.what'));

        let excluded = 0;
        const errorMessage = `Failed to exclude components: [${inFilePath}] -> [${outFilePath}]`;

        // Читаем входной файл.
        fs.readFile(inFilePath, 'utf-8').then((data) => {

            // Синхронно разбираем XML.
            var doc = new DOMParser().parseFromString(data, 'application/xml');

            // Проходим по списку файлов для удаления.
            for (let fileSource of fileSources) {

                // Ищем соответствующий элемент.
                var fileNode = /** @type {Element} */ (xselect(`//wi:File[@Source='${fileSource}']`, doc, /*single*/ true));

                if (!fileNode)
                    return reject(new Error(`${errorMessage}: File node not found for source [${fileSource}].`));

                // Проверяем его родительский компонент.
                var componentNode = fileNode.parentNode;

                if (!componentNode || "Component" !== componentNode.localName)
                    return reject(new Error(`${errorMessage}: "${componentNode.localName}" is not a valid parent for File with source [${fileSource}]. Expected parent: Component.`));

                var childCount = 0;
                var childNodes = componentNode.childNodes;
                for (var i = 0; i < childNodes.length; i++) {
                    var childNode = childNodes[i];
                    if (childNode.nodeType !== componentNode.ELEMENT_NODE) continue;
                    childCount++;
                }

                if (childCount > 1)
                    return reject(new Error(`${errorMessage}: multiple children in Component for File for Source [${fileSource}]`));

                var parent = componentNode.parentNode;

                if (!parent)
                    return reject(new Error(`${errorMessage}: missing parent for Component for File for Source [${fileSource}]`));

                // Удаляем весь компонент.
                parent.removeChild(componentNode)

                excluded++;
            }

            var serializer = new XMLSerializer();

            // Записываем выходной файл.
            fs.writeFile(outFilePath, pd.xml(serializer.serializeToString(doc)).trim())
                .then(() => {

                    winston.info(`Successfully excluded ${excluded}/${fileSources.length} components: [${inFilePath}] -> [${outFilePath}]`);
                    return resolve();

                })
                .catch((err) => {

                    winston.error(err);
                    return reject(new Error(`${errorMessage}: failed to save output file: ${err.message}`));

                });

        }).catch((err) => {

            winston.error(err);
            return reject(new Error(`${errorMessage}: failed to read input file: ${err.message}`));

        });

    });

}

/** Добавить ссылки на авто-обнаруженные компоненты в основной файл.
 * @param {Object} options опции вызова функции.
 * @param {string} options.main основной файл.
 * @param {string} options.heat файл, сформированный утилитой heat.exe.
 * @param {string} options.to файл для записи.
 * @returns {Promise}
 */
function AddComponentRefs(options) {

    return new Promise((resolve, reject) => {

        if (!options) return reject(new Error('Argument missing: options'));

        var mainFilePath = options.main;
        if (!mainFilePath) return reject(new Error('Argument missing: options.main'));

        var heatFilePath = options.heat;
        if (!heatFilePath) return reject(new Error('Argument missing: options.heat'));

        var outFilePath = options.to;
        if (!outFilePath) return reject(new Error('Argument missing: options.to'));

        const errorMessage = `Failed to add component refs: [${mainFilePath}] + [${heatFilePath}] -> [${outFilePath}]`;

        let refsCount = 0;

        // Читаем оба файла.
        Promise.all([

            fs.readFile(mainFilePath, 'utf-8'),
            fs.readFile(heatFilePath, 'utf-8')

        ]).then((res) => {

            try {

                // Синхронно разбираем XML.
                var mainDoc = new DOMParser().parseFromString(res[0], 'application/xml');
                var heatDoc = new DOMParser().parseFromString(res[1], 'application/xml');

                // Ищем первый узел <Feature>
                var featureElement = /** @type {Element} */ (xselect('/wi:Wix/wi:Product/wi:Feature', mainDoc, /*single*/ true));
                if (!featureElement) return reject(new Error('Failed to add component refs: feature node not found.'));

                const componentIdAttributes = /** @type {Attr[]} */ (xselect('//wi:Component/@Id', heatDoc))
                for (var componentIdAttr of componentIdAttributes) {

                    var refElement = mainDoc.createElementNS(WixNamespace, 'ComponentRef');
                    refElement.setAttribute("Id", componentIdAttr.value);

                    featureElement.appendChild(refElement);
                    refsCount++;
                }

                var serializer = new XMLSerializer();

                // Записываем выходной файл.
                fs.writeFile(outFilePath, pd.xml(serializer.serializeToString(mainDoc)).trim())
                    .then(() => {

                        winston.info(`Successfully added component refs: [${mainFilePath}] + [${heatFilePath}] -> [${outFilePath}]`);
                        return resolve();

                    })
                    .catch((err) => {

                        winston.error(err);
                        return reject(new Error(`${errorMessage} failed to write output file: ${err.message}`));

                    });

            } catch (err) {

                winston.error(err);
                return reject(new Error(`${errorMessage} failed to parse or transform input files: ${err.message}`));
            }

        }).catch((err) => {

            winston.error(err);
            return reject(new Error(`${errorMessage} failed to read input files: ${err.message}`));

        });

    });

}

/** Выполнить исключение заданных компонент из авто-скомпонованного файла.
 * @param {string} roleName -Имя роли.
 * @param {string} roleVersion - Версия роли.
 * @param {Object.<string, string>} wixTemplates - Словарь имя-путь шаблонов Wix..
 * @param {Paths} paths - Контейнер путей.
 * @param {string} outDir - Выходная папка для создания MSI.
 * @returns {Promise}
 */
function MakeRoleMsi(roleName, roleVersion, paths, wixTemplates, outDir) {

    return new Promise((resolve, reject) => {


        const errorMessage = `Failed to make MSI-installer for role [${roleName}] and version [${roleVersion}]`;

        // Папка шаблона роли и необходимые файлы в ней.
        const roleTemplateDir = wixTemplates[roleName];
        if (!roleTemplateDir) return ErrorAndReject(reject, errorMessage + `: failed to determine wix template for role [${roleName}]: template is not declared in coob`)

        const template = {

            dir: roleTemplateDir,

            variables_wxi: path.join(roleTemplateDir, 'Variables.wxi'),
            heat_exclude: path.join(roleTemplateDir, '.heat-exclude'),
            main_wxs: path.join(roleTemplateDir, 'Main.wxs'),
            icon_ico: path.join(roleTemplateDir, 'Icon.ico'),
            arp_wxi: path.join(roleTemplateDir, 'ARP.wxi'),
            banner_bmp: path.join(roleTemplateDir, 'Banner.bmp'),
            dialog_bmp: path.join(roleTemplateDir, 'Dialog.bmp')

        }

        // Папка дистрибутива роли.
        const roleDistributiveDir = path.join(paths.distributivesDir, roleName);

        // Временная папка роли.
        const roleTempDir = path.join(paths.tempDir, `${roleName}-${roleVersion}-${RandomString()}`);
        const temp = {

            dir: roleTempDir,

            variables_wxi: path.join(roleTempDir, 'Variables.wxi'),
            icon_ico: path.join(roleTempDir, 'Icon.ico'),
            arp_wxi: path.join(roleTempDir, 'ARP.wxi'),
            banner_bmp: path.join(roleTempDir, 'Banner.bmp'),
            dialog_bmp: path.join(roleTempDir, 'Dialog.bmp'),
            raw_files_wxs: path.join(roleTempDir, 'RawFiles.wxs'),
            files_wxs: path.join(roleTempDir, 'Files.wxs'),
            full_wxs: path.join(roleTempDir, 'Full.wxs'),
            files_wixobj: path.join(roleTempDir, 'Files.wixobj'),
            full_wixobj: path.join(roleTempDir, 'Full.wixobj')

        }

        // Папка и файлы WIX.
        const wix = {

            dir: paths.wixDir,

            heat_exe: path.join(paths.wixDir, 'heat.exe'),
            candle_exe: path.join(paths.wixDir, 'candle.exe'),
            light_exe: path.join(paths.wixDir, 'light.exe'),

            util_ext_dll: path.join(paths.wixDir, 'WixUtilExtension.dll'),
            ui_ext_dll: path.join(paths.wixDir, 'WixUIExtension.dll'),
            netfx_ext_dll: path.join(paths.wixDir, 'WiXNetFxExtension.dll')

        }

        // Пользовательские файлы.
        const user = {
            variables_wxi: path.join(paths.rootDir, `${roleName}.vars.wxi`)
        }

        // Выходной файл.
        const roleOutMsi = path.join(outDir, `${roleName}-${roleVersion}.msi`);
        const roleOutWixPdb = path.join(outDir, `${roleName}-${roleVersion}.wixpdb`);


        Promise.all([

            fs.pathExists(user.variables_wxi),

            fs.ensureDir(temp.dir),
            fs.ensureDir(outDir),

            fs.remove(roleOutMsi),
            fs.remove(roleOutWixPdb)

        ]).then(res => {

            // Копируем либо переопределенный файл переменных, либо из шаблона.
            let fromVarsPath = res[0] ? user.variables_wxi : template.variables_wxi;
            winston.info(`Copying variables file [${fromVarsPath}] -> [${temp.variables_wxi}].`);
            fs.copy(fromVarsPath, temp.variables_wxi).then(() => {

                // Запускаем авто-сборщик.
                Spawn(
                    wix.heat_exe,
                    [
                        'dir',
                        roleDistributiveDir,
                        '-ke',
                        '-scom',
                        '-gg',
                        '-sfrag',
                        '-sreg',
                        '-suid',
                        '-srd',
                        '-dr', 'PROGRAM_FILES_ROLE_FOLDER',
                        '-out', temp.raw_files_wxs
                    ]
                ).then(res => {

                    if (res.code !== 0)
                        return ErrorAndReject(reject, errorMessage + ': collector (heat.exe) exited with non-zero code.')

                    // Читаем файл исключений.
                    ReadExlusionsFile(template.heat_exclude).then((res) => {


                        Promise.all([

                            // Копируем файл с собранными компонентами в исходном виде или исключаем из него компоненты.
                            (res.exists && res.lines.length > 0)
                                ? ExcludeComponents({ from: temp.raw_files_wxs, to: temp.files_wxs, what: res.lines })
                                : fs.copy(temp.raw_files_wxs, temp.files_wxs),

                            fs.copy(template.arp_wxi, temp.arp_wxi),
                            fs.copy(template.icon_ico, temp.icon_ico),

                        ]).then(() => {

                            // Добавляем ссылки на авто-собранные компоненты.
                            AddComponentRefs({
                                main: template.main_wxs,
                                heat: temp.files_wxs,
                                to: temp.full_wxs
                            }).then(() => {

                                // Запускаем компилятор.
                                Spawn(
                                    wix.candle_exe,
                                    [
                                        '-ext', wix.util_ext_dll,
                                        '-ext', wix.ui_ext_dll,
                                        '-ext', wix.netfx_ext_dll,
                                        `-dVersion=${roleVersion}`,
                                        '-out', temp.dir + '\\\\',
                                        temp.full_wxs,
                                        temp.files_wxs
                                    ]
                                ).then(res => {

                                    if (res.code !== 0)
                                        return ErrorAndReject(reject, 'Compiler (candle.exe) exited with non-zero code.')

                                    // Запускаем компоновщик.
                                    Spawn(
                                        wix.light_exe,
                                        [
                                            '-v',
                                            '-b', roleDistributiveDir,
                                            '-ext', wix.util_ext_dll,
                                            '-ext', wix.ui_ext_dll,
                                            '-ext', wix.netfx_ext_dll,
                                            `-dWixUIDialogBmp=${template.dialog_bmp}`,
                                            `-dWixUIBannerBmp=${template.banner_bmp}`,
                                            '-out', roleOutMsi,
                                            '-cultures:ru-RU;en-US',
                                            temp.full_wixobj,
                                            temp.files_wixobj
                                        ]
                                    ).then(() => {

                                        fs.pathExists(roleOutMsi).then(exists => {

                                            if (!exists)
                                                return reject(new Error(`${errorMessage}: resulting MSI-installer not found`));

                                            winston.info(`Successfully created MSI-installer for role name [${roleName}] and version [${roleVersion}] at [${roleOutMsi}]`);
                                            resolve();

                                        }).catch(err => ErrorAndReject(reject, errorMessage + ': failed to check if resulting MSI-installer exists', err));

                                    }).catch(err => ErrorAndReject(reject, errorMessage + ': failed execute light.exe', err));

                                }).catch(err => ErrorAndReject(reject, errorMessage + ': failed execute candle.exe', err));

                            }).catch(err => ErrorAndReject(reject, errorMessage + ': failed to add component refs', err));

                        }).catch(err => ErrorAndReject(reject, errorMessage + ': failed to copy required files to temp directory', err));

                    }).catch(err => ErrorAndReject(reject, errorMessage + ': failed to read exclusions file', err));

                }).catch(err => ErrorAndReject(reject, errorMessage + ': failed execute heat.exe', err));

            }).catch(err => ErrorAndReject(reject, errorMessage + ': failed to copy variables file to temp directory', err));

        }).catch(err => ErrorAndReject(reject, errorMessage + ': failed to check required files or create required directories', err));

    });

}

/**
 * Извлечь файл переменных для заданной роли.
 * @param {string} roleName - имя роли.
 * @param {Paths} paths - контейнер путей.
 * @param {Object.<string, string>} wixTemplates - Словарь имя-путь шаблонов Wix.
 * @param {boolean} overwrite - признак перезаписи файла.
 */
function ExtractTemplateVariables(roleName, paths, wixTemplates, overwrite) {

    return new Promise((resolve, reject) => {

        const errorMessage = `Failed to extract template variables for role [${roleName}]`;

        // Папка шаблона роли и необходимые файлы в ней.
        const roleTemplateDir = wixTemplates[roleName];
        if (!roleTemplateDir) return ErrorAndReject(reject, errorMessage + `: failed to determine wix template for role [${roleName}]: template is not declared in coob`)

        const templateVarsFile = path.join(roleTemplateDir, 'Variables.wxi');
        let roleVarsPath = path.join(paths.rootDir, `${roleName}.msi.wxi`);

        // Сразу пытаемся скопировать файл переменных из шаблона.
        fs.copy(templateVarsFile, roleVarsPath, { overwrite: overwrite, errorOnExist: !overwrite }).then(() => {

            winston.info(`Successfully copied vars file [${templateVarsFile}] -> [${roleVarsPath}]`);
            return resolve();

        }).catch((err) => {

            // Если был признак перезаписи - не нужно пытаться создать бекап из существующего файла. Выходим с ошибкой.
            winston.error(err);
            return reject(new Error(`${errorMessage}: failed to copy [${templateVarsFile}] -> [${roleVarsPath}] (overwrite: ${overwrite}): ${err.message}`));

        });
    });

}

// ------------------------------------------------------------------------------ //
// ------------------------------------------------------------------------------ //
// ---------------------------------- ЭКСПОРТЫ ---------------------------------- //
// ------------------------------------------------------------------------------ //
// ------------------------------------------------------------------------------ //

module.exports = {

    /**
     * Выполнить создания MSI для роли с заданным именем или для всех ролей.
     * @param {string} roleName - Имя роли для создания MSI.
     * @param {Paths} paths - Контейнер популярных путей.
     * @param {Object.<string, string>} requiredVersions - Словарь имя-описание требуемых версий.
     * @param {Object.<string, string>} wixTemplates - Словарь имя-путь шаблонов Wix.
     * @param {string} outDir - Выходная папка для создания MSI.
     */
    MakeRoleMsi(roleName, paths, requiredVersions, wixTemplates, outDir) {

        const errorMessage = `Failed to make MSI for role(s) [${roleName}]`

        return new Promise((resolve, reject) => {

            // Если роль не задана - создаем MSI последовательно для каждого известного шаблона.
            const roleNames = (roleName === '*' ? Object.keys(wixTemplates) : [roleName]);

            // Читаем файл версий.
            ReadAndCheckVersions(paths.versionsIniFile, requiredVersions).then(versions => {

                // Составляем цепочку обещаний из создания MSI для каждой роли.
                let promiseChain = Promise.resolve();
                const msiRoleNames = [];
                for (let roleName in versions) {

                    // Нет шаблона для такой роли.
                    if (!roleNames.includes(roleName)) continue;

                    const roleVersion = versions[roleName];

                    // Добавляем этап создания MSI для данной роли.
                    promiseChain = promiseChain.then(() => MakeRoleMsi(roleName, roleVersion, paths, wixTemplates, outDir));
                    msiRoleNames.push(roleName);

                }

                promiseChain.then(() => {

                    const m = `INFO: Created MSI-installers for roles [${msiRoleNames.join('], [')}]`;
                    winston.info(m);
                    return resolve();

                }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to execute promise chain', err));

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to read and check versions file', err));

        });

    },

    /**
     * Реализация команды создания конфигурационного файла для процедуры создания MSI для заданной роли.
     * @param {string} roleName - имя роли для создания конфигурационного файла.
     * @param {Paths} paths - контейнер путей.
     * @param {Object.<string, string>} requiredVersions - Словарь имя-описание требуемых версий.
     * @param {Object.<string, string>} wixTemplates - Словарь имя-путь шаблонов Wix.
     * @param {boolean} overwrite - признак перезаписи файла при его наличии.
     */
    CreateDefaultMsiConfigCommand(roleName, paths, requiredVersions, wixTemplates, overwrite) {

        overwrite = overwrite || false;

        const errorMessage = `Failed to create MSI-configs for role(s) [${roleName}]`

        return new Promise((resolve, reject) => {

            // Если роль не задана - создаем MSI последовательно для каждого известного шаблона.
            const roleNames = (roleName === '*' ? Object.keys(wixTemplates) : [roleName]);

            // Читаем файл версий.
            ReadAndCheckVersions(paths.versionsIniFile, requiredVersions).then(versions => {

                // Составляем цепочку обещаний из создания MSI для каждой роли.
                let promiseChain = Promise.resolve();
                const msiRoleNames = [];
                for (let roleName in versions) {

                    // Нет шаблона для такой роли.
                    if (!roleNames.includes(roleName)) continue;

                    // Добавляем этап создания MSI для данной роли.
                    promiseChain = promiseChain.then(() => ExtractTemplateVariables(roleName, paths, wixTemplates, overwrite));
                    msiRoleNames.push(roleName);

                }

                promiseChain.then(() => {

                    const m = `INFO: Create MSI-configs for roles [${msiRoleNames.join('], [')}]`;
                    winston.info(m);
                    console.log(m);
                    return resolve();

                }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to execute promise chain', err));

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to read and check versions file', err));


        });

    }

}