import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import messages


def main():
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    entries = json.loads(source.read_text(encoding="utf-8"))
    output = []
    for entry in entries:
        cls = getattr(messages, entry["schema"])
        value = cls.from_dict(entry["value"]).to_dict()
        if value != entry["value"]:
            raise AssertionError(f"roundtrip mismatch: {entry['name']}\n{value!r}\n!=\n{entry['value']!r}")
        output.append({"name": entry["name"], "value": value})
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"python roundtrip OK: {len(output)} messages")


if __name__ == "__main__":
    main()
