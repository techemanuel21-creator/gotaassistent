"""Text filters for the voice: a bilingual glitch must never be read aloud, and a reply is made speakable (no quotes, markdown or odd symbols)."""
import re

_EN_STOP = set("the of in to and for with on at by from is are was were be that this these those it its as an or not but participates purpose".split())
_PT_STOP = set("o a os as um uma de da do das dos em no na nos nas para por com sem que e é se ao à aos mas ou ele ela eles elas seu sua seus suas você vocês pois como mais já foi são ser está ter".split())
_GLUED_PIPE = re.compile(r"(?<=\w)\|(?=\w)")


def _unpipe(segment):
    """Text with `word|english words|word` glitches (a model's bilingual alignment leaking into the answer): the English pieces between the bars, and English words stuck
    to a bar, are dropped; the Portuguese stays. Lines that look like a markdown table (starting with a bar) and text without a glued bar are left as they are."""
    out = []
    for line in segment.split("\n"):
        if line.lstrip().startswith("|") or not _GLUED_PIPE.search(line):
            out.append(line)
            continue
        pieces = _GLUED_PIPE.split(line)
        kept = []
        for i, piece in enumerate(pieces):
            words = piece.split()
            plain = [re.sub(r"\W", "", w).lower() for w in words]
            ascii_run = bool(words) and all(w.isascii() for w in words)
            if ascii_run and any(w in _EN_STOP for w in plain) and not any(w in _PT_STOP for w in plain):
                continue   # a whole English piece between the bars
            k = 0   # English words stuck at the end of a piece, right before a bar
            while k < min(4, len(words)) and i < len(pieces) - 1 and words[-1 - k].isascii() and plain[-1 - k] not in _PT_STOP and re.sub(r"\W", "", words[-1 - k]):
                k += 1
            if k and any(w in _EN_STOP for w in plain[len(plain) - k:]):
                words = words[:-k]
            kept.append(" ".join(words))
        out.append(" ".join(x for x in kept if x))
    return "\n".join(out)


def clean_glitch(text):
    """Removes bilingual `word|english|word` fragments from an answer (code blocks and tables are untouched). Cheap: returns at once when there is no glued bar."""
    if "|" not in text or not _GLUED_PIPE.search(text):
        return text
    parts = re.split(r"(```.*?```)", text, flags=re.S)
    for i in range(0, len(parts), 2):
        parts[i] = _unpipe(parts[i])
    return "".join(parts)


def speakable_text(text):
    """A reply for the voice: no quotation marks, markdown, brackets or slashes between words (they were read as odd characters), single spaces."""
    s = re.sub(r"```.*?```", " ", text, flags=re.S)
    s = re.sub(r"[“”„\"«»]", "", s)
    s = re.sub(r"[‘’`´]", "", s)
    s = re.sub(r"[*#~]{1,3}(?=\w)|(?<=\w)[*#~]{1,3}", "", s)   # markdown emphasis (underscores inside names such as JOB_TAPE are kept)
    s = re.sub(r"(?<=[A-Za-zÀ-ÿ])\s*/\s*(?=[A-Za-zÀ-ÿ])|\s*[|\\]\s*", ", ", s)   # Stopped / Failed -> Stopped, Failed (dates and paths with digits keep their slashes)
    s = re.sub(r"[\[\]{}<>]", "", s)
    s = re.sub(r"\s+([,.;:!?])", r"\1", s)
    s = re.sub(r",\s*,", ",", s)
    return re.sub(r"[ \t]+", " ", s).strip()
