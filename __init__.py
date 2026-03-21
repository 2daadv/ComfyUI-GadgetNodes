from .py.core import *
from .py.logic import *
from .py.prompt import *
from .py.model import *
from .py.image import *
from .py.train import *

NODE_CLASS_MAPPINGS = {
    "Normalize Prompt": NormalizePromptNode,
    "Check NSFW Prompt": CheckNsfwPromptNode,
    "Prompt To FileName": PromptToFileNameNode,
    "Any Pass": AnyPassNode,
    "+1": IncrementNode,
    "-1": DecrementNode,
    "Select Nth Items Of AnyList": SelectNthItemsOfAnyListNode,
    "Load Checkpoint Preset": CheckpointPresetLoaderNode,
    "Edit SD Lora Information": SDLoraInfoEditorNode,
    "Edit SD Checkpoint Information": SDCheckpointInfoEditorNode,
    "Prompt Palette": PromptPaletteNode,
    "Select Input Folder": InputFolderSelectNode,
    "Edit Train Tags": TrainTagsEditNode,
    "Crop Images(Manual)": ManualCropImagesNode, 
}

WEB_DIRECTORY = "./js"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', "WEB_DIRECTORY"]
