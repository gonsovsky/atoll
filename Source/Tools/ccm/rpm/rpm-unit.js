const path = require('path');
const fs = require('fs');
const fsx = require('fs-extra');
const { resolve } = require('path');
const { readdir } = require('fs').promises;
const {devtool} = require('../devtool/devtool');

class RpmUnit
{
    constructor(roleName, roleVersion, distribDir, roleTemplateDir, roleTempDir, outDir, paths) {
        let arch = "x86_64";
        let roleRelease="1"
        let description= roleName + " Application";
        let vendor="OOO";
        this.roleTempDir = roleTempDir
        this.paths = paths

        this.Opts = {
            source: distribDir,
            out: path.join(outDir, roleName + "-" + roleVersion + "-" + roleRelease + "." + arch +  ".rpm"),

            name: roleName,
            arch: arch,
            version: roleVersion,
            release: roleRelease,
            description: description,
            vendor: vendor,

            // Создание общей папки с полными правами для всех прользователей.
            postInstall: 'mkdir -p -m 1777 /usr/share/coral',

            // Рекурсивное удаление папки приложения.
            postRemove: 'rm -rf opt/coral/' + roleName,

            // Права для файлов из состава RPM.
            content: [
                {
                    relative: "opt/coral/aps/" + roleName,
                    mode: "755"
                },
                {
                    relative: "opt/coral/" + roleName+ "/resources/dotnet/dotnet",
                    mode: "755"
                },
                {
                    relative: "opt/coral/" + roleName +"/chrome-sandbox",
                    owner: "root",
                    mode: "4755"
                },
                {
                    relative: "usr/share/applications/" + roleName + ".desktop",
                    mode: "644"
                }
            ]
        }
    }

    async Install()
    {
        await devtool(this.roleTempDir,this.paths, "/rpm/rpm-devtool.js", this.Opts)
    }
}

module.exports = RpmUnit