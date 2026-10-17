import json
from faster_whisper import WhisperModel
m = WhisperModel("small", device="cpu", compute_type="int8")
segs, info = m.transcribe("vo.wav", language="ar", word_timestamps=True, vad_filter=False)
out = []
for s in segs:
    for w in s.words:
        out.append({"w": w.word, "s": round(w.start, 2), "e": round(w.end, 2)})
json.dump(out, open("words.json", "w"), ensure_ascii=False)
print(len(out))
