import os,yaml
from logging import getLogger

PROMPT_PATH = os.path.join(os.path.dirname(os.path.realpath(__file__)), "prompt")
if not os.path.exists(PROMPT_PATH):
    os.makedirs(PROMPT_PATH)
MODELS_CONFIG_FILE_PATH = os.path.join(os.path.dirname(__file__), "models_config.yaml")
TRAIN_CONFIG_FILE_PATH = os.path.join(os.path.dirname(__file__), "train_config.yaml")

logger = getLogger("GadgetNodes")

# wildcard trick is taken from pythongossss's
class AnyType(str):
    def __eq__(self, _):
        return True

    def __ne__(self, _):
        return False

any_type = AnyType("*")

def flatten(any_list:list):
    result = []
    if any_list:
        for item in any_list:
            if isinstance(item, list):
                result.extend(item)
            else:
                result.append(item)
    return result

def load_train_config():
    try:
        with open(TRAIN_CONFIG_FILE_PATH, 'r', encoding='utf-8') as file:
            return yaml.safe_load(file) or {}
    except Exception:
        logger.exception(f"[GadgetNodes] An error occured during read {TRAIN_CONFIG_FILE_PATH}.")
    return {}

train_config = load_train_config()

# グローバル変数で結果を一時保持
crop_results = {}
