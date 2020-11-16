const fs = require('fs');
const fsx = require('fs-extra');
const helper = require('../helpers');
const path = require('path');
const { ChooseFreeFsName, RandomString, Spawn } = require('../helpers');


class DevTool {
    constructor(paths) {
        this.paths = paths;
    }

    async exec(script, arg) {
        fsx.ensureDirSync(this.paths.tempDir)
        let argJs = JSON.stringify(arg)
        let file = path.join(this.paths.tempDir, 'devtool-' + RandomString())
        fs.writeFileSync(file, argJs)
        let dotnet = this.paths.dotnetExeFile
        let dll = this.paths.devtoolFile
        script = path.join(__dirname, script)
        let args = [dll, "e", script, file]
        let retcode = await helper.Spawn(dotnet, args)
        fs.unlinkSync(file)
        if (retcode.code != 0)
            throw `devtool.exec faulted with command: ${dotnet} ${args.join(' ')}. return code ${JSON.stringify(retcode)}`;
        return JSON.parse(retcode.stdout);
    }

    async unzip(inFile, outDir){
       let opts = {
           inFile: inFile,
           outDir: outDir,
           overwrite: true
       }
       return await this.exec("devtool-zip.js", opts)
    }

    async CoobProps(propFile){
        return await this.exec("devtool-coobProps.js", propFile)
    }
}

module.exports = DevTool

