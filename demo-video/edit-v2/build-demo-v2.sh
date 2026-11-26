#!/bin/bash
# Tavern Trader demo video v2 build — segments + concat.
# v2 shows the product working LIVE: a real poll triggered on camera (poll #13),
# then the fresh on-chain state. All inputs verified real footage.
# VO scripts in edit-v2/voN.txt. v1 file tavern-trader-demo.mp4 untouched.
# NOTE (26 Nov prize correction): vo7.txt changed "twenty" -> "forty" thousand
# dollars, so seg7 is built fresh below (not reused from v1). Regenerate its
# audio first: /opt/hatch/bin/tts speak --output edit-v2/vo7.mp3 --text-stdin < edit-v2/vo7.txt
set -euo pipefail
cd ~/workspace/gnome-tavern/demo-video
E=edit-v2
E1=edit
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
FONTB=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
VENC="-c:v libx264 -pix_fmt yuv420p -r 30 -preset medium -crf 20"
CLIP=recorder/clips/v2-live-poll.mp4

# --- title card text files (drawtext textfile avoids escaping) ---
printf 'TAVERN TRADER' > $E/title1.txt
printf 'A paper-trading agent on Gno.land testnet' > $E/title2.txt
printf 'PAPER ONLY \xe2\x80\x94 no real money' > $E/title3.txt
printf '60 seconds later' > $E/later.txt

# --- 1. live-loop segment (raw clip timeline, probed frame by frame) ---
# 0-7s about:blank/loading; 8-13s dashboard top, Polls 12, ETH 64 (before)
# ~13-14.5s auto-scroll to chat (typing happens below the fold, not legible)
# 15-17.5s JSON reply "Poll started in the background" (command accepted)
# 17.5-134.5s dead wait on the JSON page (CUT entirely)
# 137-152s reloaded dashboard: Polls 13, ETH 65, scroll to journal w/ poll #13
ffmpeg -y -v error -ss 9.0  -i $CLIP -to 4.0  $VENC -an $E/seg2a.mp4
ffmpeg -y -v error -ss 15.0 -i $CLIP -to 2.5  $VENC -an $E/seg2b.mp4
ffmpeg -y -v error -f lavfi -i color=c=black:s=1920x1080:r=30:d=1.5 -vf \
  "drawtext=fontfile=$FONT:textfile=$E/later.txt:fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p" \
  $VENC -an $E/seg2later.mp4
ffmpeg -y -v error -ss 137.0 -i $CLIP -to 15.0 $VENC -an $E/seg2c.mp4
printf "file 'seg2a.mp4'\nfile 'seg2b.mp4'\nfile 'seg2later.mp4'\nfile 'seg2c.mp4'\n" > $E/list2v.txt
ffmpeg -y -v error -f concat -safe 0 -i $E/list2v.txt -c copy $E/seg2v.mp4
echo "live loop done: $(ffprobe -v error -show_entries format=duration -of csv=p=0 $E/seg2v.mp4)s"

# --- 2. stills -> Ken Burns clips (portrait fit into 1920x1080, dark pad, zoom 1.00->1.08) ---
kb() { # $1=img $2=duration $3=frames $4=out
  ffmpeg -y -v error -loop 1 -framerate 30 -t "$2" -i "$1" -vf \
    "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0a0a0a,zoompan=z='1+0.08*on/$3':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,format=yuv420p" \
    $VENC -an "$4"
}
kb explorer-shots-v2/gnoweb-v2-1.png 9 269 $E/kb-gnoweb-v2-1.mp4
kb explorer-shots-v2/gnoweb-v2-2.png 9 269 $E/kb-gnoweb-v2-2.mp4
kb explorer-shots-v2/gnoscan-v2-1.png 7 209 $E/kb-gnoscan-v2-1.mp4
kb explorer-shots-v2/gnoscan-v2-2.png 7 209 $E/kb-gnoscan-v2-2.mp4
kb explorer-shots-v2/gnoscan-v2-3.png 6 179 $E/kb-gnoscan-v2-3.mp4
kb explorer-shots-v2/dorahacks-v2-01.png 9 269 $E/kb-dora-v2-1.mp4
kb explorer-shots-v2/dorahacks-v2-02.png 9 269 $E/kb-dora-v2-2.mp4
echo "ken burns done"

printf "file 'kb-gnoweb-v2-1.mp4'\nfile 'kb-gnoweb-v2-2.mp4'\n" > $E/list3.txt
printf "file 'kb-gnoscan-v2-1.mp4'\nfile 'kb-gnoscan-v2-2.mp4'\nfile 'kb-gnoscan-v2-3.mp4'\n" > $E/list6.txt
printf "file 'kb-dora-v2-1.mp4'\nfile 'kb-dora-v2-2.mp4'\n" > $E/list7v.txt
ffmpeg -y -v error -f concat -safe 0 -i $E/list3.txt -c copy $E/seg3v.mp4
ffmpeg -y -v error -f concat -safe 0 -i $E/list6.txt -c copy $E/seg6v.mp4
ffmpeg -y -v error -f concat -safe 0 -i $E/list7v.txt -c copy $E/seg7v.mp4
echo "stills segments done"

# --- 3. title card (11.0s: vo1 10.25s + pad) ---
ffmpeg -y -v error -f lavfi -i color=c=black:s=1920x1080:r=30:d=11.0 -vf \
  "drawtext=fontfile=$FONTB:textfile=$E/title1.txt:fontsize=96:fontcolor=white:x=(w-text_w)/2:y=360,drawtext=fontfile=$FONT:textfile=$E/title2.txt:fontsize=44:fontcolor=white:x=(w-text_w)/2:y=520,drawtext=fontfile=$FONT:textfile=$E/title3.txt:fontsize=40:fontcolor=0xFFD54A:x=(w-text_w)/2:y=610,format=yuv420p" \
  $VENC -an $E/seg1v.mp4
echo "title card done"

# --- 4. mux new segments with their VO (pad VO with silence to segment length) ---
mux() { # $1=segnum $2=video $3=duration
  ffmpeg -y -v error -i "$2" -i $E/vo$1.mp3 -filter_complex \
    "[1:a]aresample=48000,apad=whole_dur=$3[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -ac 2 -t "$3" $E/seg$1.mp4
}
mux 1 $E/seg1v.mp4 11.0
mux 2 $E/seg2v.mp4 23.0
mux 3 $E/seg3v.mp4 18.0
mux 6 $E/seg6v.mp4 20.0
# seg7 video track is the FRESH DoraHacks stills (26 Nov, showing $40,000);
# audio is the new vo7 ("forty thousand"). Built in section 2 above.
mux 7 $E/seg7v.mp4 18.0
echo "new segments muxed"

# --- 5. reused v1 segments (VO4/5/8 texts byte-identical to v1; v1 segs verified) ---
cp $E1/seg4.mp4 $E/seg4.mp4
cp $E1/seg5.mp4 $E/seg5.mp4
cp $E1/seg8.mp4 $E/seg8.mp4
echo "v1 segments reused"

# --- 6. final concat (re-encode for uniform timestamps) ---
printf "file 'seg1.mp4'\nfile 'seg2.mp4'\nfile 'seg3.mp4'\nfile 'seg4.mp4'\nfile 'seg5.mp4'\nfile 'seg6.mp4'\nfile 'seg7.mp4'\nfile 'seg8.mp4'\n" > $E/list-final.txt
ffmpeg -y -v error -f concat -safe 0 -i $E/list-final.txt \
  -c:v libx264 -pix_fmt yuv420p -r 30 -preset medium -crf 20 \
  -c:a aac -b:a 128k -ac 2 tavern-trader-demo-v2.mp4
echo "BUILD DONE"
for i in 1 2 3 4 5 6 7 8; do
  printf "seg%s: " "$i"; ffprobe -v error -show_entries format=duration -of csv=p=0 $E/seg$i.mp4
done
echo "--- final ---"
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_type,codec_name,width,height -of default=noprint_wrappers=1 tavern-trader-demo-v2.mp4
