<script setup lang="ts">
import type {
  JSONSchema,
  ObjectJSONSchema,
  SchemaType
} from "@/lib/jsonschema-editor/types/jsonSchema"
import type { ValidationTreeNode } from "@/lib/jsonschema-editor/types/validation"
import { withObjectSchema } from "@/lib/jsonschema-editor/types/jsonSchema"
import ArrayEditor from "./types/ArrayEditor.vue"
import BooleanEditor from "./types/BooleanEditor.vue"
import NumberEditor from "./types/NumberEditor.vue"
import ObjectEditor from "./types/ObjectEditor.vue"
// ── Synchronous imports — NO defineAsyncComponent / Suspense ──
// Async components + Suspense caused re-resolution loops during type changes.
import StringEditor from "./types/StringEditor.vue"

const props = withDefaults(
  defineProps<{
    schema: JSONSchema
    path: string[]
    readOnly?: boolean
    validationNode?: ValidationTreeNode
    depth?: number
    insideNested?: boolean
  }>(),
  { readOnly: false, depth: 0, insideNested: false }
)

const emit = defineEmits<{
  change: [schema: ObjectJSONSchema]
}>()

function getType() {
  return withObjectSchema(
    props.schema,
    s => (s.type || "object") as SchemaType,
    "string" as SchemaType
  )
}
</script>

<template>
  <StringEditor
    v-if="getType() === 'string'"
    :schema="schema"
    :path="path"
    :read-only="readOnly"
    :validation-node="validationNode"
    :depth="depth"
    @change="emit('change', $event)"
  />
  <NumberEditor
    v-else-if="getType() === 'number'"
    :schema="schema"
    :path="path"
    :read-only="readOnly"
    :validation-node="validationNode"
    :depth="depth"
    @change="emit('change', $event)"
  />
  <NumberEditor
    v-else-if="getType() === 'integer'"
    :schema="schema"
    :path="path"
    :read-only="readOnly"
    :validation-node="validationNode"
    :depth="depth"
    :integer="true"
    @change="emit('change', $event)"
  />
  <BooleanEditor
    v-else-if="getType() === 'boolean'"
    :schema="schema"
    :path="path"
    :read-only="readOnly"
    :validation-node="validationNode"
    :depth="depth"
    @change="emit('change', $event)"
  />
  <ObjectEditor
    v-else-if="getType() === 'object'"
    :schema="schema"
    :path="path"
    :read-only="readOnly"
    :validation-node="validationNode"
    :depth="depth"
    :inside-nested="insideNested"
    @change="emit('change', $event)"
  />
  <ArrayEditor
    v-else-if="getType() === 'array'"
    :schema="schema"
    :path="path"
    :read-only="readOnly"
    :validation-node="validationNode"
    :depth="depth"
    :inside-nested="insideNested"
    @change="emit('change', $event)"
  />
</template>
