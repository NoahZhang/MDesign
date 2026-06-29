import type { Tool } from '../pi-ai'
import { deleteFiles, getProject, replaceInFile, writeFile } from '../lib/store'
import { fileKind } from '../lib/types'

// Tool definitions handed to the model. JSON-Schema params work for both
// Anthropic (input_schema) and OpenAI (function.parameters).
export const TOOLS: Tool[] = [
  {
    name: 'write_file',
    description:
      'Create or overwrite a design file in the project. Use .html for pages/prototypes, .jsx/.tsx for components. The file appears in the Design Files panel immediately.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to project root, e.g. "Landing Page.html" or "screenshots/a.png".' },
        content: { type: 'string', description: 'Full file content.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a project file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in the project (optionally under a folder prefix).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Folder prefix, or omit for the whole project.' } },
    },
  },
  {
    name: 'str_replace_edit',
    description: 'Replace an exact substring in a file. old_string must occur exactly once.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete one or more files or folders from the project.',
    parameters: {
      type: 'object',
      properties: { paths: { type: 'array', items: { type: 'string' } } },
      required: ['paths'],
    },
  },
  {
    name: 'ask_questions',
    description:
      'Ask the user a short round of clarifying questions, rendered as an interactive form with selectable options (plus a free-text "Other"). Use this BEFORE building when the request is ambiguous. Do NOT ask questions in plain prose — always use this tool. After calling it, end your turn; the user\'s answers come back as the tool result.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short form title, e.g. "Quick questions about the timeline".' },
        questions: {
          type: 'array',
          description: 'The questions to ask.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'snake_case answer key' },
              title: { type: 'string', description: 'The question.' },
              subtitle: { type: 'string', description: 'Optional helper text.' },
              kind: { type: 'string', enum: ['text-options', 'svg-options', 'freeform'] },
              options: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'For text-options: choice labels. For svg-options: each item is an inline SVG string (~150x110 viewBox) for a visual choice (e.g. a layout). Include sensible choices plus "Decide for me"/"Explore a few options"/"Other" where useful.',
              },
              multi: { type: 'boolean', description: 'Allow selecting multiple options.' },
            },
            required: ['id', 'title', 'kind'],
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'done',
    description:
      'Finish the turn and open a file in the preview pane for the user. Call once the deliverable is ready.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File to surface in the preview.' } },
      required: ['path'],
    },
  },
]

export interface ToolOutcome {
  result: string
  isError?: boolean
  /** When set, the agent loop stops and the workspace opens this file. */
  selectFile?: string
}

export function executeTool(projectId: string, name: string, rawInput: unknown): ToolOutcome {
  const input = (rawInput ?? {}) as Record<string, any>
  const project = getProject(projectId)
  if (!project) return { result: 'Project not found.', isError: true }

  switch (name) {
    case 'write_file': {
      const path = String(input.path ?? '').trim()
      if (!path) return { result: 'write_file requires a path.', isError: true }
      const created = writeFile(projectId, path, String(input.content ?? ''))
      return { result: `${created ? 'Created' : 'Updated'} ${path} (${fileKind(path)}).`, selectFile: path }
    }
    case 'read_file': {
      const f = project.files.find((x) => x.path === input.path)
      if (!f) return { result: `No such file: ${input.path}`, isError: true }
      return { result: f.content.slice(0, 8000) }
    }
    case 'list_files': {
      const prefix = String(input.path ?? '')
      const list = project.files
        .filter((f) => f.path.startsWith(prefix))
        .map((f) => f.path)
        .join('\n')
      return { result: list || '(empty)' }
    }
    case 'str_replace_edit': {
      const ok = replaceInFile(projectId, String(input.path), String(input.old_string), String(input.new_string))
      return ok
        ? { result: `Edited ${input.path}.`, selectFile: String(input.path) }
        : { result: `Could not edit ${input.path}: old_string not found.`, isError: true }
    }
    case 'delete_file': {
      const paths = Array.isArray(input.paths) ? input.paths.map(String) : []
      deleteFiles(projectId, paths)
      return { result: `Deleted: ${paths.join(', ')}` }
    }
    case 'ask_questions':
      // Handled specially by the agent loop (it pauses for the user); never executed here.
      return { result: 'Awaiting user answers.' }
    case 'done':
      return { result: 'done', selectFile: input.path ? String(input.path) : undefined }
    default:
      return { result: `Unknown tool: ${name}`, isError: true }
  }
}
