const path = require('path');
const fs = require('fs');
const fsx = require('fs-extra');
const { resolve } = require('path');
const { readdir } = require('fs').promises;
const DevTool = require('../devtool/devtool')

class RpmUnit
{
    constructor(roleName, roleVersion, distribDir, roleTemplateDir, outDir, paths) {
        let group = "coral";
        let product = `/opt/${group}/${roleName}`;

        let arch = "x86_64";
        let roleRelease="1"
        let description= roleName + " Application";
        let vendor="OOO";

        this.paths = paths
        this.distribDir = distribDir;
        this.tempDirContainer = path.join(paths.tempDir, "/rpm-" + roleName)
        this.tempDir = path.join(this.tempDirContainer, product);

        this.Opts = {
            source: this.tempDirContainer,
            out: path.join(outDir, roleName + "-" + roleVersion + "-" + roleRelease + "." + arch +  ".rpm"),

            name: roleName,
            arch: arch,
            version: roleVersion,
            release: roleRelease,
            description: description,
            vendor: vendor,

            // Создание общей папки с полными правами для всех прользователей.
            postInstall: `mkdir -p -m 1777 /usr/share/${group}`,

            // Рекурсивное удаление папки приложения.
            postRemove: `rm -rf ${product}`,

            // Права для файлов из состава RPM.
            content: [
                {
                    relative: `${product}`,
                    mode: "755"
                },
                {
                    relative: `${product}/resources/dotnet/dotnet`,
                    mode: "755"
                },
                {
                    relative: `${product}/chrome-sandbox`,
                    owner: "root",
                    mode: "4755"
                },
                {
                    relative: `usr/share/applications/${roleName}.desktop`,
                    mode: "644"
                }
            ]
        }
    }

    prepareFiles() {
        fsx.ensureDirSync(this.tempDir)
        fsx.emptyDirSync(this.tempDir)
        fsx.copySync(this.distribDir, this.tempDir);
    }

    clear(){
        fsx.emptyDirSync(this.tempDir)
        fsx.removeSync(this.tempDir)
    }

    async Install()
    {
        this.prepareFiles();
        let devtool = new DevTool(this.paths)
        await devtool.exec("../rpm/rpm-devtool.js", this.Opts)
        this.clear()
    }
}

module.exports = RpmUnit