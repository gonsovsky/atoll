//СКРИПТ ДЛЯ DEVTOOL.

function main(args) {
    if (args.length < 1)
        throw new Error(`Invalid cmd args count (${args.length}). Expected 1: <script>`);
    var script = args[0]
    var obj = FileSystem.readJson(script)
    var ret = JSON.stringify(CoobUtils.readProps(obj))
    Console.log(ret)
}

main(Environment.commandLine);
