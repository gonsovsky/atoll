const { MakeRoleRpm } = require('../rpm-tools');

const roleName="*";

const paths = {
    "rootDir": "C:\\Atoll\\Source",
    "coobsDir": "C:\\Atoll\\Source\\Coobs",
    "deployDir": "C:\\Atoll\\Source\\Deploy",
    "distributivesDir": "C:\\Atoll\\Source\\Distributives",
    "tempDir": "C:\\Atoll\\Source\\Temp",
    "toolsDir": "C:\\Atoll\\Source\\Tools",
    "dotnetDir": "C:\\Atoll\\Source\\Tools\\dotnet",
    "dotnetExeFile": "C:\\Atoll\\Source\\Tools\\dotnet\\win-x86\\dotnet.exe",
    "vBuildDir": "C:\\Atoll\\Source\\Tools\\vbuild",
    "vBuildDllFile": "C:\\Atoll\\Source\\Tools\\vbuild\\vbuild.dll",
    "vBuildFunctionsDir": "C:\\Atoll\\Source\\Tools\\vbuild\\Functions",
    "wixDir": "C:\\Atoll\\Source\\Tools\\wix",
    "szipDir": "C:\\Atoll\\Source\\Tools\\7zip",
    "varsValidatorDllFile": "C:\\Atoll\\Source\\Tools\\vars-validator\\vars.validator.dll",
    "configIniFile": "C:\\Atoll\\Source\\config.ini",
    "versionsIniFile": "C:\\Atoll\\Source\\versions.ini",
    "composedCoobDir": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll",
    "coobPropsFile": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll\\coob.props",
    "coobModuleFile": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll\\scripts\\composition\\index.js",
    "devtoolFile": "C:\\Atoll\\Source\\Tools\\devtool\\Coral.DevTool.dll"
}

const requiredVersions=
    {
        "agent": "Агент",
        "ctu": "Терминальный узел конфигурации",
        "dtu": "Терминальный узел данных",
        "dhu": "Узел накопления данных",
        "dpu.events": "Узел обработки данных (события)",
        "dpu.jobs": "Узел обработки данных (регулярные задания)",
        "mmu": "Узел управления и обслуживания",
        "acu": "Узел контроля доступа",
        "dhUtil": "Утилита управления контейнерами данных",
        "aps": "Утилита разработки инсталляционных пакетов",
        "database": "Скрипты Базы Данных"
    }

const wixTemplates=
    {
        "agent": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll\\wix\\agent",
        "ctu": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll\\wix\\ctu",
        "dtu": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll\\wix\\dtu",
        "dhu": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll\\wix\\dhu",
        "dpu.events": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll\\wix\\dpu.events",
        "dpu.jobs": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll\\wix\\dpu.jobs",
        "acu": "C:\\Atoll\\Source\\Coobs\\Coral.Atoll\\wix\\acu"
    }

const freeDir ="C:\\Atoll\\Source\\Deploy\\test"

MakeRoleRpm(roleName, paths, requiredVersions, wixTemplates, freeDir)
    .then(res =>
    {
        console.log("okay");
        console.log(res);
    })
    .catch(res => {
        console.log("error");
        console.log(res);
    });