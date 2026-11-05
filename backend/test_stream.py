import yt_dlp, json

opts = {
    'format': 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
    'quiet': True,
    'no_warnings': True,
    'skip_download': True,
    'noplaylist': True,
    'socket_timeout': 15,
}
with yt_dlp.YoutubeDL(opts) as ydl:
    info = ydl.extract_info('https://www.youtube.com/watch?v=gPpQNzQP6gE', download=False)

formats = info.get('formats', [])
audio_only = [f for f in formats if f.get('acodec') != 'none' and f.get('vcodec') in (None, 'none', '')]
print('Audio-only formats:', len(audio_only))

audio_only.sort(key=lambda x: (x.get('tbr') or x.get('abr') or 0), reverse=True)
for f in audio_only[:4]:
    u = str(f.get('url', ''))
    ext = f.get('ext')
    abr = f.get('abr')
    tbr = f.get('tbr')
    print('  ext=%s abr=%s tbr=%s url=%s' % (ext, abr, tbr, u[:70]))

url = info.get('url', '')
print('Selected URL:', url[:80])
print('Ext:', info.get('ext'))
print('Duration:', info.get('duration'))
print('Title:', info.get('title'))

