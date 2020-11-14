//@ts-check
const fs = require('fs-extra');
const path = require('path');
const winston = require('winston');
const { ChooseFreeFsName, FN, ErrorAndReject, ErrorAndRejectConsole, ErrorAndThrow, InfoAndResolve, InfoAndResolveConsole, RandomString, Spawn } = require('./helpers');
const { Paths } = require('./paths');
const { ReadAndCheckVersions, SaveRoleVersionsVarsFile, ReadCoobVersions, SaveCoobVersionsVarsFile } = require('./version-tools');
const { TransformIniToXml } = require('./config-tools');
const { MakeRoleMsi } = require('./msi-tools');
const { MakeRoleRpm } = require('./rpm-tools');

/**
 * получить путь до 7zip
 * @param {Paths} paths - контейнер путей.
 */
function getSZipPath(paths) {
	if (process.env.USE_SYSTEM_7ZA === "true") {
		return "7za"
	}

	const szipRootDir = paths.szipDir;
	if (process.platform === "darwin") {
		return path.join(szipRootDir, "mac", "7za")
	}
	else if (process.platform === "win32") {
		return path.join(szipRootDir, "win", process.arch, "7za.exe")
	}
	else {
		return path.join(szipRootDir, "linux", process.arch, "7za")
	}
}

/**
 * Выполнить сжатие заданной папки.
 * @param {string} source - путь до исходной папки.
 * @param {string} target - путь до целевого zip-файла.
 * @param {Paths} paths - контейнер путей.
 */
function zipdirp(source, target, paths) {

    const errorMessage = `Failed to zip [${source}] -> [${target}]`;

	return Spawn(getSZipPath(paths), ['a',
		'-tzip',
		target,
		path.join(source, '*'),
		'-mmt',
		'-mm=Deflate',
		'-mtc-'])
		.catch(err => {
			ErrorAndThrow(errorMessage, err);
		});
}

module.exports = {

    /**
     * Выполнить создание всех элементов для распространения в соответствии с текущей конфигурацией.
     * @param {string} framework - вид создаваемых дистрибутивов.
     * @param {string} targetOs - вид ос для которой создаётся дистрибутив (win | lnx).
     * @param {Paths} paths - контейнер путей.
     * @param {Object.<string, string>} requiredVersions - Словарь имя-описание требуемых версий.
     * @param {Object.<string, string>} wixTemplates - Словарь имя-путь шаблонов Wix
     * @param {string} definitionsPath - Путь до файла определений переменных
     * @param {Object.<string, string>} zipItems - словарь [имя папки элемента развертывания] - [имя финального zip-файла]. 
     * @param {(framework: string, targetOs: string, versions: Object.<string, string>, coobVersions: Object.<string, string>, varsFile: string, roleVersionsVarsFile: string, coobVersionsVarsFile: string, distributivesDir: string, paths: Paths) => Promise} makeDistributives - функция создания дистрибутивов
     */
    MakeCommand(framework, targetOs, paths, requiredVersions, wixTemplates, definitionsPath, zipItems, makeDistributives) {

        const errorMessage = `Failed to make deploy items`;

        return new Promise((resolve, reject) => {

            // Выбираем свободное имя подпапки нв основе текущего времени.
            const now = new Date(Date.now());
            const desiredDirName = `${FN(now.getFullYear(), 4)}-${FN((now.getMonth()) + 1, 2)}-${FN(now.getDate(), 2)}---${FN(now.getHours(), 2)}-${FN(now.getMinutes(), 2)}`;

            // Создаем папку /Deploy при необходимости.
            fs.ensureDir(paths.deployDir).then(() => {

                ChooseFreeFsName(paths.deployDir, desiredDirName, '').then(freeDir => {

                    // Чистим папку дистрибутивов.
                    fs.emptyDir(paths.distributivesDir).then(() => {

                        console.log('INFO: Reading and checking versions file...');

                        ReadAndCheckVersions(paths.versionsIniFile, requiredVersions).then(versions => {

                            const tempRoleVersionsVarsFile = path.join(paths.tempDir, RandomString() + '.xml');

                            SaveRoleVersionsVarsFile(versions, tempRoleVersionsVarsFile).then(() => {

                                console.log('INFO: Checking component versions...');

                                ReadCoobVersions(paths.coobPropsFile).then(coobVersions => {

                                    const tempCoobVersionsVarsFile = path.join(paths.tempDir, RandomString() + '.xml');

                                    SaveCoobVersionsVarsFile(coobVersions, tempCoobVersionsVarsFile).then(() => {

                                        console.log('INFO: Reading and checking config...');

                                        const tempVarsFile = path.join(paths.tempDir, RandomString() + '.xml');

                                        // Преобразуем INI файл в XML
                                        TransformIniToXml(paths.configIniFile, definitionsPath, tempVarsFile, paths).then(() => {

                                            console.log('INFO: Making distributives...');

                                            // Создаем диструбутивы при помощи модуля из кубышки.
                                            makeDistributives(framework, targetOs, versions, coobVersions, tempVarsFile, tempRoleVersionsVarsFile, tempCoobVersionsVarsFile, paths.distributivesDir, paths).then(() => {

                                                fs.emptyDir(freeDir).then(() => {

                                                    console.log(`INFO: Making [*.zip] deploy items...(${freeDir})`);

                                                    // Выполняем zip-ование
                                                    const zipPromises = [];
                                                    for (let distrDirName in zipItems) {

                                                        const distrPath = path.join(paths.distributivesDir, distrDirName);
                                                        const zipPath = path.join(freeDir, zipItems[distrDirName] + '-' + versions[distrDirName] + '.zip');

                                                        zipPromises.push(zipdirp(distrPath, zipPath, paths));
                                                    }

                                                    Promise.all(zipPromises).then(() => {

                                                        console.log('INFO: Making [*.rpm] deploy items...');
                                                        MakeRoleRpm('*', paths, requiredVersions, wixTemplates, freeDir).then(() => {

                                                            if (process.platform !== "win32") {

                                                                // УСПЕШНО ЗАВЕРШИЛИСЬ (НА LINUX)
                                                                console.log(`INFO: Successfully created all deploy items at [${freeDir}].`);
                                                                return resolve();
                                                            }

                                                            console.log('INFO: Making [*.msi] deploy items...');
                                                            MakeRoleMsi('*', paths, requiredVersions, wixTemplates, freeDir).then(() => {
                                                                // УСПЕШНО ЗАВЕРШИЛИСЬ (НА WINDOWS)
                                                            console.log(`INFO: Successfully created all deploy items at [${freeDir}].`);
                                                            return resolve();
                                                            }) .catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to make MSI installers`, err));

                                                        }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to make RPM installers`, err));

                                                    }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to make zips`, err));

                                                }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to ensure empty dir at [${freeDir}]`, err));

                                            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed make distributives with coob module`, err));

                                        }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to transform INI vars to XML`, err));

                                    }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to create coob versions vars file`, err));
                                    
                                }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to read coob props`, err));

                            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to create role versions vars file`, err));

                        }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to read version file(s)`, err));

                    }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to ensure empty dir at [${paths.distributivesDir}]`, err));

                }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to choose free dir name', err));

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, `: failed to ensure dir at [${paths.deployDir}]`, err));

        });
    }

}