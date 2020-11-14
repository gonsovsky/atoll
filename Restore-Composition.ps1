param (
	# Репозиторий кубышек
	[String]
	$RepoUri = "http://coobs.sftconsult.synology.me:5000/",
	
	# Идентификатор кубышки
	[String]
	$CoobName,

	# Версия кубышки
	[String]
    $CoobVersion,
    
    # Максимальная версия (не включая).
    [String]
    $IgnoreVersionsUpFrom,

	# Директория для извлечения кубышек
	[String]
	$OutDir
);

# Константы.
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition;
$BIN_DIR = Join-Path $SCRIPT_DIR "Bin";
$MODULE_PATH = Join-Path $SCRIPT_DIR "Coral.Composition.Bundle.psm1";

# Импортируем модуль.
Import-Module $MODULE_PATH -Force

# Задаем путь до выходной папки по-умолчанию.
if ([System.String]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = $BIN_DIR
}

# Выполняем восстановление всего Composition.
Restore-Composition -RepoUri $RepoUri -CoobName $CoobName -CoobVersion $CoobVersion -IgnoreVersionsUpFrom $IgnoreVersionsUpFrom -OutDir $OutDir | Out-Null;