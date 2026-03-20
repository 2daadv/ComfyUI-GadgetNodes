from . import api
from .nodes import *

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
}

WEB_DIRECTORY = "./js"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', "WEB_DIRECTORY"]
