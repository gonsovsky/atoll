$MODULE_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition;
$SOURCE_DIR = Join-Path -Path $MODULE_DIR -ChildPath "Source"
$BIN_DIR = Join-Path -Path $MODULE_DIR -ChildPath "Bin"

# Получить значение последней доступной версии кубышки.
function Get-LatestCoobVersion {

    param (
       
        [String]
        [Parameter(Mandatory = $true)]
        $RepoUri,

        # Идентификатор кубышки
	    [String]
	    $CoobName,

        [String]
        $IgnoreVersionsUpFrom
    );

    $CoobPrefix = "$CoobName.";
    $CoobSuffix = ".coob";

    $response = Invoke-RestMethod -Uri $RepoUri

    $maxVersion = $null;
    if (![System.String]::IsNullOrWhiteSpace($IgnoreVersionsUpFrom)) {

        if (![System.Version]::TryParse($IgnoreVersionsUpFrom, [ref] $maxVersion)) {
            Write-Error "Failed to parse minimum version to exclude."
            return;
        }

    }

    $latestVersion = $null;
    foreach ($prop in $response.PSObject.Properties) {

        $fileName = $prop.Name;
        if (!$fileName.StartsWith($CoobPrefix) -or !$fileName.EndsWith($CoobSuffix)) { continue; }


        $versionString = $fileName.SubString($CoobPrefix.Length, $fileName.Length - $CoobSuffix.Length - $CoobPrefix.Length);
        $version = $null;
        if (![System.Version]::TryParse($versionString, [ref] $version)) { continue; }

        if ($null -ne $maxVersion -and $maxVersion.CompareTo($version) -le 0) { continue; }
        
        if ($null -eq $latestVersion -or $latestVersion.CompareTo($version) -le 0) { 
            $latestVersion = $version;
            continue;
        }

    }

    return $latestVersion;
}

# Выполнить копирование всех инструментов.
function Copy-Tools([String]$OutDir) {

    Write-Host
    Write-Host "Copying tools...";

    # Копирование директории инструментов
    $sourceItems = Get-ChildItem $SOURCE_DIR;
    foreach ($item in $sourceItems)
    {
        $itemPath = Join-Path -Path $SOURCE_DIR -ChildPath $item
        Copy-Item $itemPath -Destination $OutDir -Recurse -Force
    }
}

# Выполнить восстановление заданной кубышки.
function Restore-Coob ([String]$CoobName, [String]$RepoUri, [String]$OutDir) {

    
    Write-Host
    Write-Host "Downloading coob '$CoobName'...";
    
    $global:ProgressPreference = 'SilentlyContinue'
    $downloadCoobUri = $RepoUri + "/$CoobName.coob";
    $outPath = Join-Path $OutDir "$CoobName.zip";
    Invoke-RestMethod -ContentType "application/octet-stream" -Uri $downloadCoobUri  -OutFile $outPath;

    Write-Host "Extracting coob '$CoobName'..."

    $global:ProgressPreference = 'SilentlyContinue'
    $match = [regex]::Match($CoobName, "(?<coobName>.+)\.(?<coobVersion>\d+\.\d+\.\d+(.\d)*)");
    $coobNameWithoutVersion = $match.Groups["coobName"].Value;
    $extractPath = Join-Path $OutDir $coobNameWithoutVersion;
    Expand-Archive $outPath -DestinationPath $extractPath -Force

    Write-Host "Removing coob '$CoobName' archive..."

    Remove-Item $outPath -Force | Out-Null
}

# Выполнить чтение зависимостей кубышки.
function Read-CoobDependencies ([String]$CoobDir) {

    [xml]$xml = Get-Content (Join-Path $CoobDir 'coob.props');

    return $xml.Project.ItemGroup.CoobReference.Include;
}

# Выполнить восстановление всего содержимого Composition.
function Restore-Composition {

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
        $OutDir = $BIN_DIR

    );

    # Если версия кубышки не задана - определяем автоматически максимальную, учитывая параметр игнорирования.
    if ([System.String]::IsNullOrWhiteSpace($CoobVersion)) { 

        $CoobVersion = Get-LatestCoobVersion -RepoUri $RepoUri -CoobName $CoobName -IgnoreVersionsUpFrom $IgnoreVersionsUpFrom; 
    }

    if ([System.String]::IsNullOrWhiteSpace($CoobVersion)) { 

        Write-Error "Failed to determine latest coob version";
        return; 
    }

    $OutDir = [System.IO.Path]::GetFullPath($OutDir)

    Write-Host
    Write-Host '---'
    Write-Host "Repository URI: $RepoUri";
    Write-Host "$CoobName version: $CoobVersion";
    Write-Host "Output directory: $OutDir";
    Write-Host '---'
    Write-Host

    # Чистим выходную папку.
    if (Test-Path $OutDir) {

        Write-Host "Removing existing output directory at '$OutDir'..."
        Remove-Item -Path $OutDir -Force -Recurse | Out-Null
    }

    # Создаем выходную папку.
    New-Item -Path $OutDir -ItemType Directory | Out-Null

    # Создаем папку кубышек.
    $coobsOutDir = Join-Path $OutDir "Coobs";
    New-Item $coobsOutDir -ItemType Directory -Force | Out-Null 

    # Загрузка $CoobName
    $coobFullName = "$CoobName.$CoobVersion"
    Restore-Coob -CoobName $coobFullName -RepoUri $RepoUri -OutDir $coobsOutDir;

    # Чтение кубышек - зависимостей
    Write-Host
    Write-Host "Reading '$coobFullName' dependencies...";
    $atollCoobDir = Join-Path $coobsOutDir "$CoobName"
    $coobReferences = Read-CoobDependencies -CoobDir $atollCoobDir;

    # Загрузка зависимых кубышек
    foreach($coobReference in $coobReferences)
    {
        Restore-Coob -CoobName $coobReference -RepoUri $RepoUri -OutDir $coobsOutDir;
    }

    # Копирование директории инструментов
    Copy-Tools -OutDir $OutDir;

    # Возвращаем версию Atoll.
    return $CoobVersion;
}