//@ts-check
const path = require('path');
const fs = require('fs');
const os = require('os');

module.exports = {

    /** 
     * Класс, содержащий пути до файлов и папок, используемых различными модулями инструментария.
     */
    Paths: class Paths {

        /**
         * Конструктор.
         * @param {string} rootDir - корневая папка.
         */
        constructor(rootDir) {

            /** Корневая папка инструментария. */
            this.rootDir = rootDir;



            /** Папка расположения кубышек.. */
            this.coobsDir = path.join(this.rootDir, 'Coobs');
            /** Выходная папка для создания элементов распространения. */
            this.deployDir = path.join(this.rootDir, 'Deploy');
            /** Папка дистрибутивов. */
            this.distributivesDir = path.join(this.rootDir, 'Distributives');
            /** Папка временных файлов. */
            this.tempDir = path.join(this.rootDir, 'Temp');
            /** Папка инструментов. */
            this.toolsDir = path.join(this.rootDir, 'Tools');

            /** Файл DLL с devtools. */
            this.devtoolFile = path.join(this.rootDir, 'Tools/devtool/Coral.DevTool.dll');

            /** Папка расположения .NET Core Runtime. */
            this.dotnetDir = path.join(this.toolsDir, 'dotnet');
            /** Путь основного файла .NET Core Runtime. */
            this.dotnetExeFile = process.platform === "win32" ? path.join(this.dotnetDir, 'win-x86', 'dotnet.exe') : path.join(this.dotnetDir, 'linux-x64', 'dotnet');
            /** Папка расположения vBuild. */
            this.vBuildDir = path.join(this.toolsDir, 'vbuild');
            /** Основной исполняемый файл vBuild. */
            this.vBuildDllFile = path.join(this.vBuildDir, 'vbuild.dll');
            /** Папка сборок с функциями vBuild. */
            this.vBuildFunctionsDir = path.join(this.vBuildDir, 'Functions');
            /** Папка расположения WIX. */
			this.wixDir = path.join(this.toolsDir, 'wix');
	        /** Папка расположения 7Zip. */
			this.szipDir = path.join(this.toolsDir, '7zip');
            /** Основной исполняемый файл валидатора переменных. */
            this.varsValidatorDllFile = path.join(this.toolsDir, 'vars-validator', 'vars.validator.dll');

            /** Основной конфигурационный файл в формате INI, редактируемый перед компоновкой дистрибутивов. */
            this.configIniFile = path.join(this.rootDir, 'config.ini');
            /** Файл объявления версий, используемый при компоновке. */
            this.versionsIniFile = path.join(this.rootDir, 'versions.ini');

            /** Путь до папки кубышки, для которой выполняется композиция. */
            this.composedCoobDir = path.join(this.coobsDir, 'Coral.Atoll');

            /** Путь до файла-описателя кубышки. */
            this.coobPropsFile = path.join(this.composedCoobDir, 'coob.props');

            /** Путь до отделяемого JS-модуля, входящего в поставку кубышки. */
            this.coobModuleFile = path.join(this.composedCoobDir, 'scripts', 'composition', 'index.js');
        }
    }
}