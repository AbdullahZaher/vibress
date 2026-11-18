"""Independent OAI structural validation of generated documents; no network references."""
import copy
import json
import pathlib
import sys
from importlib.metadata import version
from jsonschema import Draft202012Validator
from referencing import Registry

root = pathlib.Path(__file__).parent
schema = json.loads((root / "openapi-3.1-2025-11-23.json").read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema, registry=Registry())
documents = json.loads(pathlib.Path(sys.argv[1]).read_text())
if len(documents) != 2:
    raise SystemExit("expected two generated OpenAPI documents")
for document in documents:
    validator.validate(document)
    invalid = copy.deepcopy(document)
    del invalid["info"]
    if validator.is_valid(invalid):
        raise SystemExit("invalid missing info accepted")
    invalid = copy.deepcopy(document)
    operations = [op for methods in invalid["paths"].values() for op in methods.values()]
    path_param = next(p for op in operations for p in op["parameters"] if p["in"] == "path")
    path_param["required"] = False
    if validator.is_valid(invalid):
        raise SystemExit("invalid optional path parameter accepted")
    invalid = copy.deepcopy(document)
    operations = [op for methods in invalid["paths"].values() for op in methods.values()]
    next(p for op in operations for p in op["parameters"] if p["in"] == "path")["schema"] = 123
    if validator.is_valid(invalid):
        raise SystemExit("invalid schema object accepted")
print(f"M04_OAS31_INDEPENDENT PASS jsonschema={version('jsonschema')} documents=2 invalid_controls=6")
