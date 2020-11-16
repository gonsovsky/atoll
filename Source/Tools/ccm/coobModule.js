
const path = require('path');
const winston = require('winston');
const { Paths } = require('./paths');

/**
 * Отделяемый модуль, идущий в составе кубышки.
 * @typedef {Object} CoobModule
 * @prop {(targetOs: string) => string} GetVariablesDefinitionFile - фукнция получения файла переменных для целевой ОС.
 * @prop {Object.<string, string>} RequiredVersions - словарь имя-описание требуемых версий.
 * @prop {Object.<string, string>} WixTemplates - словарь имя-путь для шаблонов Wix.
 * @prop {Object.<string, string>} ZipItems - словарь [имя папки элемента развертывания] - [имя финального zip-файла].
 * @prop {(flavor:string, targetOs: string, versions: Object.<string, string>, varsFile: string, distributivesDir: string, paths: Paths) => Promise} MakeDistributives - функция, выполняющая создание дистрибутивов.
 */

let coobModule = /** @type {CoobModule} */ (null);

module.exports = {
    /** @type {CoobModule} */ getCoobModule() {

        const paths = new Paths(path.dirname(path.dirname(__dirname)));
        coobModule = /** @type {CoobModule} */ (null);

        try {

            coobModule = require(paths.coobModuleFile);

        } catch (err) {

            //winston.error(err);
        }

        if (!coobModule) {
            if (process.argv.length < 1 || process.argv[2] != "restore" ) {
                const errorMessage = `Please run "ccm restore [coobName] [coobVersion]" command. Required moudule [${paths.coobModuleFile}] is not found.`;
                console.log(errorMessage);
                winston.error(errorMessage);
            }
        }
        return     /** @type {CoobModule} */coobModule;
    }
}