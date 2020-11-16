#!/usr/bin/env node
// @ts-check

const winston = require('winston');
const program = require('commander');

const path = require('path');
const { Paths } = require('./paths');

const { CreateDefaultConfigCommand, CheckConfigCommand, UpgradeConfigCommand } = require('./config-tools');
const { CreateDefaultVersionsCommand, CreateMonoVersionsCommand, CheckVersionsCommand, UpgradeVersionsCommand } = require('./version-tools');
const { CreateDefaultMsiConfigCommand } = require('./msi-tools');
const { MakeCommand } = require('./make-tools');
const { RestoreCoobsCommand } = require('./restore-tools');
const {getCoobModule} = require('./coobModule');

// Функция, вызываемая при любом выходе из приложения.
function exit(code) {

    code = code || 0;

    winston.info(`===== CCM EXITED (CODE: ${code}) =====`, () => {

        process.exitCode = code;

    });

}

/** Контейнер путей. */
const paths = new Paths(path.dirname(path.dirname(__dirname)));

// По-умолчанию пишем только в файл.
winston.remove(winston.transports.Console);
winston.add(winston.transports.File, { filename: path.join(paths.rootDir, 'log.log'), json: false });

winston.info(`===== CCM LAUNCHED =====`);
winston.info(`CCM COMMANDLINE: ${process.argv.join(' ')}`);

// Команда восстановления кубышек.
program
    .command('restore [coobName] [coobVersion]')
    .description("restore Coobs from the repository for further deployment [coobName] [coobVersion]")
    .option('-o, --overwrite', "overwrite [coobs] if exists", true)
    .action((coobName, coobVersion, cmd) => {

        RestoreCoobsCommand(paths, coobName, coobVersion, cmd.overwrite)
            .then(() => { exit(0); })
            .catch(err => { exit(-1); });

    });

let coobModule = /** @type {CoobModule} */ getCoobModule() ;

if (coobModule){

    // Глобальная опция, доступная для всех команд.
    program
        .option('--log-to-console', 'show log messages in console', () => {
            winston.add(winston.transports.Console);
            winston.cli();
        });


    // Команда создания файла переменных со значениями по-умолчанию.
    program
        .command('default-config [targetOs]')
        .description("create default [config.ini]")
        .option('-o, --overwrite', "overwrite [config.ini] if exists", false)
        .option('-a, --advanced', 'include advanced variables', false)
        .action((targetOs, cmd) => {

            if (!targetOs)
                targetOs = 'win';

            CreateDefaultConfigCommand(paths.configIniFile, coobModule.GetVariablesDefinitionFile(targetOs), cmd.overwrite, cmd.advanced)
                .then(() => {
                    exit(0);
                })
                .catch(err => {
                    exit(-1);
                });

        });

    // Команда проверки корректности файла переменных.
    program
        .command('check-config [targetOs]')
        .description("check existing [config.ini]")
        .option('-a, --advanced', 'require all advanced variables to be set', false)
        .action((targetOs, cmd) => {

            if (!targetOs)
                targetOs = 'win';

            CheckConfigCommand(paths.configIniFile, coobModule.GetVariablesDefinitionFile(targetOs), paths, cmd.advanced)
                .then(() => {
                    exit(0);
                })
                .catch(err => {
                    exit(-1);
                });

        });

    // Команда апгрейда файла переменных.
    program
        .command('upgrade-config [targetOs]')
        .description("upgrade [config.ini] to current version")
        .option('-a, --advanced', 'include advanced variables from current version', false)
        .option('-o, --overwrite', "overwrite [config.ini] even if not changed", false)
        .action((targetOs, cmd) => {

            if (!targetOs)
                targetOs = 'win';

            UpgradeConfigCommand(paths.configIniFile, coobModule.GetVariablesDefinitionFile(targetOs), cmd.overwrite, cmd.advanced)
                .then(() => {
                    exit(0);
                })
                .catch(err => {
                    exit(-1);
                });

        });

    // Команда создания файла версий со значениями по-умолчанию.
    program
        .command('default-versions')
        .description("create default [versions.ini]")
        .option('-o, --overwrite', "overwrite [versions.ini] if exists", false)
        .action(cmd => {

            CreateDefaultVersionsCommand(paths.versionsIniFile, coobModule.RequiredVersions, cmd.overwrite)
                .then(() => {
                    exit(0);
                })
                .catch(err => {
                    exit(-1);
                });

        });

    // Команда создания файла версий с единым значением версии для всех артефактов.
    program
        .command('mono-versions <version>')
        .description("create [versions.ini] with specified version for all items")
        .option('-o, --overwrite', "overwrite [versions.ini] if exists", false)
        .action((version, cmd) => {

            CreateMonoVersionsCommand(paths.versionsIniFile, coobModule.RequiredVersions, version, cmd.overwrite)
                .then(() => {
                    exit(0);
                })
                .catch(err => {
                    exit(-1);
                });

        });

    // Команда выполнения проверок корректности файла версий.
    program
        .command('check-versions')
        .description("check existing [versions.ini]")
        .action(cmd => {

            CheckVersionsCommand(paths.versionsIniFile, coobModule.RequiredVersions)
                .then(() => {
                    exit(0);
                })
                .catch(err => {
                    exit(-1);
                });

        });

    // Команда апгрейда файла версий.
    program
        .command('upgrade-versions')
        .description("upgrade [versions.ini] to current version")
        .option('-o, --overwrite', "overwrite [versions.ini] even if not changed", false)
        .action(cmd => {

            UpgradeVersionsCommand(paths.versionsIniFile, coobModule.RequiredVersions, cmd.overwrite)
                .then(() => {
                    exit(0);
                })
                .catch(err => {
                    exit(-1);
                });

        });

    // Команда создания хостов
    program
        .command('make [flavor] [targetOs]')
        .description("make deploy items using [config.ini]+[versions.ini]")
        .action((flavor, targetOs) => {

            MakeCommand(flavor, targetOs, paths, coobModule.RequiredVersions, coobModule.WixTemplates, coobModule.GetVariablesDefinitionFile(targetOs), coobModule.ZipItems, coobModule.MakeDistributives)
                .then(() => {
                    exit(0);
                })

                .catch((err) => {
                    exit(-1);
                });

        });

    // Команда извлечения переменных для создания MSI-файла.
    program
        .command('default-msi-config <role>', '', {noHelp: true})
        .description('[ADVANCED] create default configs for MSI')
        .option('-o, --overwrite', 'overwrite file(s) if exist(s).', false)
        .action((roleName, cmd) => {

            CreateDefaultMsiConfigCommand(roleName, paths, coobModule.RequiredVersions, coobModule.WixTemplates, cmd.overwrite)
                .then(() => {
                    exit(0);
                })
                .catch((err) => {
                    exit(-1);
                });

        });

    // Все остальные команды.
    program
        .command('*', '', {noHelp: true})
        .action((commandName) => {

            const m = `Unknown command [${commandName}] specified. Type --help for list of available commands.`;
            winston.error(m);
            console.log(m);
            exit(-1);

        });

    program.on('--help', () => {
        process.stdout.write('\n  Example scenario 1:\n\n    ccm default-config\n    ccm default-versions\n\n    *** Edit config.ini and versions.ini ***\n\n    ccm make\n');
        process.stdout.write('\n  Example scenario 2:\n\n    *** Copy existing config.ini and versions.ini ***\n\n    ccm upgrade-config\n    ccm upgrade-versions\n\n    *** Edit config.ini and versions.ini ***\n\n    ccm make\n');

    });
}

program.parse(process.argv);

// Проверка, что задано имя команды.
if (program.args.length < 1) {

    const m = `No command specified. Type --help for list of available commands.`
    winston.error(m);
    console.log(m);
    exit(-1);
}