const fs = require('fs');
const helper = require('../helpers');
const path = require('path');
const { ChooseFreeFsName, Spawn } = require('../helpers');


module.exports = {
    devtool: async function (tempDir,paths, script, arg) {
        let argJs = JSON.stringify(arg)
        let file = await ChooseFreeFsName(tempDir, 'devtool', '')
        fs.writeFileSync(file, argJs)
        let dotnet = paths.dotnetExeFile
        let dll = paths.devtoolFile
        script = path.join(__dirname, "../" + script)
        let args = [dll, "e", script, file]
        let retcode = await helper.Spawn(dotnet, args)
        fs.unlinkSync(file)
        if (retcode.code != 0)
            throw `Devtool call failure. cmd: ${dotnet}. argments: ${args.join(' ')}. return code ${JSON.stringify(retcode)}`;
    }
}