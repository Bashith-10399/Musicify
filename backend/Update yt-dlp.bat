@echo off
title MusicFlow - Delete Old Cache
echo Deleting yt-dlp cache...
rmdir /s /q "%USERPROFILE%\.cache\yt-dlp" 2>nul
rmdir /s /q "%TEMP%\yt-dlp" 2>nul
pip install --upgrade yt-dlp
echo Done! yt-dlp updated.
pause

