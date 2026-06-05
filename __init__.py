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
    "Int Equals": IntEqualsNode,
    "Int Not Equals": IntNotEqualsNode,
    "Int Nearly Equals": IntNearlyEqualsNode,
    "Float Nearly Equals": FloatNearlyEqualsNode,
    "0": Int0Node,
    "1": Int1Node,
    "-1": Int_1Node,
    "64": Int64Node,
    "256": Int256Node,
    "512": Int512Node,
    "1024": Int1024Node,
    "Select Nth Items Of AnyList": SelectNthItemsOfAnyListNode,
    "Load Checkpoint Preset": CheckpointPresetLoaderNode,
    "Load Checkpoint or Diffusion Model": LoadCheckpointOrDiffusionModelNode,
    "Edit SD Lora Information": SDLoraInfoEditorNode,
    "Edit SD Checkpoint Information": SDCheckpointInfoEditorNode,
    "Prompt Palette": PromptPaletteNode,
    "Select Input Folder": InputFolderSelectNode,
    "Edit Train Tags": TrainTagsEditNode,
    "Crop Images (Manual)": ManualCropImagesNode,
    "Load Images From Folder": LoadImagesFromFolderNode,
    "Select Image Indices": ImageIndicesSelectorNode,
    "Smart Resize Images": SmartResizeImageNode,
    "Refine Images": ImageRefinerNode
}

WEB_DIRECTORY = "./js"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', "WEB_DIRECTORY"]
