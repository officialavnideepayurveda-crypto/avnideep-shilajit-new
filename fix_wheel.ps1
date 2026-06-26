$path = "e:\Avnideep Ayurveda landinge page 2026\Avnideep shilajit complete with certificate june 26\Avnideep shilajit\Avnideep-Shilajit\index.html"
$content = [System.IO.File]::ReadAllText($path)
$old = "const segCenterAngle = targetIdx * segAngle + segAngle / 2;"
$new = "const segCenterAngle = targetIdx * segAngle + segAngle / 2 - Math.PI / 2;"
$newContent = $content.Replace($old, $new)
[System.IO.File]::WriteAllText($path, $newContent)
Write-Host "Wheel angle calculation FIXED!"
