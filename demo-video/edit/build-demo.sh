#!/bin/bash
# Tavern Trader demo video build — segments + concat.
# All inputs verified real footage; VO scripts in edit/voN.txt.
set -euo pipefail
cd ~/workspace/gnome-tavern/demo-video
E=edit
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
FONTB=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
VENC="-c:v libx264 -pix_fmt yuv420p -r 30 -preset medium -crf 20"

# --- title/end card text files (drawtext textfile avoids escaping) ---
printf 'TAVERN TRADER' > $E/title1.txt
printf 'A paper-trading agent on Gno.land testnet' > $E/title2.txt
printf 'PAPER ONLY \xe2\x80\x94 no real money' > $E/title3.txt
printf 'Verify it yourself' > $E/end1.txt
printf 'Repo: github.com/Thabiiey411beta \xe2\x80\x94 Tavern Trader' > $E/end2.txt
printf 'Realm: gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader' > $E/end3.txt
printf 'Run npm test' > $E/end4.txt

# --- 1. trim video clips (drop blank/black lead-in + tail) ---
# b-ui: black 0-5.4s, white loading page to ~7.5s, black tail from 26.57s -> 7.5..26.5 (19.0s)
ffmpeg -y -v error -ss 7.5 -i recorder/clips/b-ui.mp4 -to 19.0 $VENC -an $E/seg3v.mp4
# c-code: black 0-4.87s, black tail from 31.57s -> 5.0..31.5 (26.5s)
ffmpeg -y -v error -ss 5.0 -i recorder/clips/c-code.mp4 -to 26.5 $VENC -an $E/seg4v.mp4
# d-backtest: black 0-3.7s, black tail from 22.03s -> 3.8..22.0 (18.2s)
ffmpeg -y -v error -ss 3.8 -i recorder/clips/d-backtest.mp4 -to 18.2 $VENC -an $E/seg5v.mp4
echo "trims done"

# --- 2. stills -> Ken Burns clips (portrait 1275x1650 fit into 1920x1080, dark pad, zoom 1.00->1.08) ---
kb() { # $1=img $2=duration $3=frames $4=out
  ffmpeg -y -v error -loop 1 -framerate 30 -t "$2" -i "$1" -vf \
    "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0a0a0a,zoompan=z='1+0.08*on/$3':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,format=yuv420p" \
    $VENC -an "$4"
}
kb explorer-shots/gnoweb-1.png 9  269 $E/kb-gnoweb1.mp4
kb explorer-shots/gnoweb-2.png 9  269 $E/kb-gnoweb2.mp4
kb explorer-shots/gnoscan-1.png 10 299 $E/kb-gnoscan1.mp4
kb explorer-shots/gnoscan-2.png 10 299 $E/kb-gnoscan2.mp4
kb explorer-shots/gnoscan-3.png 10 299 $E/kb-gnoscan3.mp4
kb explorer-shots/dorahacks-01.png 9 269 $E/kb-dora1.mp4
kb explorer-shots/dorahacks-02.png 9 269 $E/kb-dora2.mp4
echo "ken burns done"

# concat stills into segment videos
printf "file 'kb-gnoweb1.mp4'\nfile 'kb-gnoweb2.mp4'\n" > $E/list2.txt
printf "file 'kb-gnoscan1.mp4'\nfile 'kb-gnoscan2.mp4'\nfile 'kb-gnoscan3.mp4'\n" > $E/list6.txt
printf "file 'kb-dora1.mp4'\nfile 'kb-dora2.mp4'\n" > $E/list7.txt
ffmpeg -y -v error -f concat -safe 0 -i $E/list2.txt -c copy $E/seg2v.mp4
ffmpeg -y -v error -f concat -safe 0 -i $E/list6.txt -c copy $E/seg6v.mp4
ffmpeg -y -v error -f concat -safe 0 -i $E/list7.txt -c copy $E/seg7v.mp4
echo "stills segments done"

# --- 3. title card (7.0s: vo1 6.43s + pad) and end card (6.0s: vo8 5.45s + pad) ---
ffmpeg -y -v error -f lavfi -i color=c=black:s=1920x1080:r=30:d=7.0 -vf \
  "drawtext=fontfile=$FONTB:textfile=$E/title1.txt:fontsize=96:fontcolor=white:x=(w-text_w)/2:y=360,drawtext=fontfile=$FONT:textfile=$E/title2.txt:fontsize=44:fontcolor=white:x=(w-text_w)/2:y=520,drawtext=fontfile=$FONT:textfile=$E/title3.txt:fontsize=40:fontcolor=0xFFD54A:x=(w-text_w)/2:y=610,format=yuv420p" \
  $VENC -an $E/seg1v.mp4
ffmpeg -y -v error -f lavfi -i color=c=black:s=1920x1080:r=30:d=6.0 -vf \
  "drawtext=fontfile=$FONTB:textfile=$E/end1.txt:fontsize=72:fontcolor=white:x=(w-text_w)/2:y=300,drawtext=fontfile=$FONT:textfile=$E/end2.txt:fontsize=40:fontcolor=white:x=(w-text_w)/2:y=450,drawtext=fontfile=$FONT:textfile=$E/end3.txt:fontsize=32:fontcolor=white:x=(w-text_w)/2:y=540,drawtext=fontfile=$FONT:textfile=$E/end4.txt:fontsize=40:fontcolor=0xFFD54A:x=(w-text_w)/2:y=640,format=yuv420p" \
  $VENC -an $E/seg8v.mp4
echo "cards done"

# --- 4. mux each segment video with its VO (pad VO with silence to segment length) ---
mux() { # $1=segnum $2=video $3=duration
  ffmpeg -y -v error -i "$2" -i $E/vo$1.mp3 -filter_complex \
    "[1:a]aresample=48000,apad=whole_dur=$3[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -ac 2 -t "$3" $E/seg$1.mp4
}
mux 1 $E/seg1v.mp4 7.0
mux 2 $E/seg2v.mp4 18.0
mux 3 $E/seg3v.mp4 19.0
mux 4 $E/seg4v.mp4 26.5
mux 5 $E/seg5v.mp4 18.2
mux 6 $E/seg6v.mp4 30.0
mux 7 $E/seg7v.mp4 18.0
mux 8 $E/seg8v.mp4 6.0
echo "segments muxed"

# --- 5. final concat (re-encode for uniform timestamps) ---
printf "file 'seg1.mp4'\nfile 'seg2.mp4'\nfile 'seg3.mp4'\nfile 'seg4.mp4'\nfile 'seg5.mp4'\nfile 'seg6.mp4'\nfile 'seg7.mp4'\nfile 'seg8.mp4'\n" > $E/list-final.txt
ffmpeg -y -v error -f concat -safe 0 -i $E/list-final.txt \
  -c:v libx264 -pix_fmt yuv420p -r 30 -preset medium -crf 20 \
  -c:a aac -b:a 128k -ac 2 tavern-trader-demo.mp4
echo "BUILD DONE"
for i in 1 2 3 4 5 6 7 8; do
  printf "seg%s: " "$i"; ffprobe -v error -show_entries format=duration -of csv=p=0 $E/seg$i.mp4
done
echo "--- final ---"
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_type,codec_name,width,height -of default=noprint_wrappers=1 tavern-trader-demo.mp4
