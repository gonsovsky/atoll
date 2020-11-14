//@ts-check
const path = require('path');
const fs = require('fs-extra');
const winston = require('winston');

const { ReadAndCheckVersions } = require('./version-tools');
const { Paths } = require('./paths');
const RpmUnit = require('./rpm/rpm-unit')
const { RandomString, Spawn, ErrorAndReject, ErrorAndRejectConsole, InfoAndResolve, InfoAndResolveConsole } = require('./helpers');


/** Выполнить исключение заданных компонент из авто-скомпонованного файла.
 * @param {string} roleName -Имя роли.
 * @param {string} roleVersion - Версия роли.
 * @param {Object.<string, string>} rpmTemplates - Словарь имя-путь шаблонов Wix..
 * @param {Paths} paths - Контейнер путей.
 * @param {string} outDir - Выходная папка для создания RPM.
 * @returns {Promise}
 */
function MakeRoleRpm(roleName, roleVersion, paths, rpmTemplates, outDir) {

    return new Promise((resolve, reject) => {

        const errorMessage = `Failed to make RPM-installer for role [${roleName}] and version [${roleVersion}]`;

        // Папка шаблона роли и необходимые файлы в ней.
        const roleTemplateDir = rpmTemplates[roleName];
        if (!roleTemplateDir) return ErrorAndReject(reject, errorMessage + `: failed to determine RPM template for role [${roleName}]: template is not declared in coob`)

        // Папка дистрибутива роли.
        const roleDistributiveDir = path.join(paths.distributivesDir, roleName);

        // Временная папка роли.
        const roleTempDir = path.join(paths.tempDir, `${roleName}-${roleVersion}-${RandomString()}`);
        fs.ensureDir(roleTempDir)

        let rpmUnit = new RpmUnit(roleName, roleVersion, roleDistributiveDir, roleTemplateDir, roleTempDir, outDir, paths)
        rpmUnit.Install()
            .then(()=> resolve())
            .catch(err => ErrorAndReject(reject, errorMessage + ': failed rpm-tools.MakeRoleRpm() ', err));
    })
}


module.exports = {

    /**
     * Выполнить создания RPM для роли с заданным именем или для всех ролей.
     * @param {string} roleName - Имя роли для создания RPM.
     * @param {Paths} paths - Контейнер популярных путей.
     * @param {Object.<string, string>} requiredVersions - Словарь имя-описание требуемых версий.
     * @param {Object.<string, string>} rpmTemplates - Словарь имя-путь шаблонов RPM.
     * @param {string} outDir - Выходная папка для создания RPM.
     */
    MakeRoleRpm(roleName, paths, requiredVersions, rpmTemplates, outDir) {

        const errorMessage = `Failed to make RPM for role(s) [${roleName}]`

        return new Promise((resolve, reject) => {

            // Если роль не задана - создаем RPM последовательно для каждого известного шаблона.
            const roleNames = (roleName === '*' ? Object.keys(rpmTemplates) : [roleName]);

            // Читаем файл версий.
            ReadAndCheckVersions(paths.versionsIniFile, requiredVersions).then(versions => {

                // Составляем цепочку обещаний из создания RPM для каждой роли.
                let promiseChain = Promise.resolve();
                const rpmRoleNames = [];
                for (let roleName in versions) {

                    // Нет шаблона для такой роли.
                    if (!roleNames.includes(roleName)) continue;

                    const roleVersion = versions[roleName];

                    // Добавляем этап создания RPM для данной роли.
                    promiseChain = promiseChain.then(() => MakeRoleRpm(roleName, roleVersion, paths, rpmTemplates, outDir));
                    rpmRoleNames.push(roleName);
                }

                promiseChain.then(() => {

                    const m = `INFO: Created RPM-installers for roles [${rpmRoleNames.join('], [')}]`;
                    winston.info(m);
                    return resolve();

                }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to execute promise chain', err));

            }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to read and check versions file', err));

        });

    },
}