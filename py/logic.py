from __future__ import annotations
import math
from .utils import *

CATEGORY_LOGIC = "Gadget/logic"

class AnyPassNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "value": (any_type, {"forceInput": True})
            }
        }
    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("value",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_LOGIC

    def run(self, value):
        return (value, )


class IncrementNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "i": ("INT", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("i + 1",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_LOGIC

    def run(self, i:int):
        return (i + 1, )


class DecrementNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "i": ("INT", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("i - 1",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_LOGIC

    def run(self, i:int):
        return (i - 1,)


class IntEqualsNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "i": ("INT", {"forceInput": True}),
                "equals": ("INT", {"default": 0})
            }
        }
    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("equals",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_LOGIC

    def run(self, i:int, equals:int):
        return (i == equals,)

class IntNotEqualsNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "i": ("INT", {"forceInput": True}),
                "not_equals": ("INT", {"default": 0})
            }
        }
    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("not_equals",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_LOGIC

    def run(self, i:int, not_equals:int):
        return (i != not_equals,)

class IntNearlyEqualsNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "a": ("INT", {"default": 0}),
                "b": ("INT", {"default": 0})
            }
        }
    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("nearly_equals",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_LOGIC

    def run(self, a:int, b:int):
        return (abs(a - b) <= 1,)

class FloatNearlyEqualsNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "a": ("FLOAT", {"default": 0.0}),
                "b": ("FLOAT", {"default": 0.0})
            }
        }
    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("nearly_equals",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_LOGIC

    def run(self, a:float, b:float):
        return (math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-5),)

class SelectNthItemsOfAnyListNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "any_list": (any_type, {"forceInput": True}),
                "index_list": ("INT", {"forceInput": True, "tooltip": "The index of the items you want to select from the list. Use negative values to select from the end (e.g., -1 for last item, -2 for second to last)."}),
            }
        }
    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("any_list",)
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "run"
    CATEGORY = CATEGORY_LOGIC
    DESCRIPTION = "Selects the Nth items from a list. If the index is out of range, it was omit."

    def run(self, any_list, index_list):
        results = []
        flatten_list = flatten(any_list)
        list_len = len(flatten_list)
        if list_len:
            for i in flatten(index_list):
                if -list_len <= i < list_len:
                    results.append(flatten_list[i])
        return (results,)


class GroupControlerNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "optional": {
                "group_name": ("STRING", {"default": ""}),
                "expand": ("BOOLEAN", {"default": True}),
                "visible": ("BOOLEAN", {"default": True}),
            },
        }
    RETURN_TYPES = ()
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_LOGIC

    def run(self, **kwargs):
        return ()
