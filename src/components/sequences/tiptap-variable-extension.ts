import { Node, mergeAttributes } from "@tiptap/core";

export const EDITOR_VARIABLES = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "company_name", label: "Company name" },
  { key: "phone", label: "Phone" },
  { key: "sender_first_name", label: "Sender first name" },
  { key: "sender_company", label: "Sender company" },
  { key: "unsubscribe_link", label: "Unsubscribe link" },
];

export function humanizeVariable(key: string): string {
  const found = EDITOR_VARIABLES.find((v) => v.key === key);
  if (found) return found.label;
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    variable: {
      insertVariable: (name: string) => ReturnType;
    };
  }
}

export const VariableExtension = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-variable"),
        renderHTML: (attrs) => ({
          "data-variable": attrs.name,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-variable]",
      },
    ];
  },

  /**
   * This is what getHTML() serializes — stored in the DB and sent through the pipeline.
   * The inner text is {{name}} so the send-pipeline regex can find and replace it.
   */
  renderHTML({ node, HTMLAttributes }) {
    const name = node.attrs.name as string;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-variable": name,
      }),
      `{{${name}}}`,
    ];
  },

  /**
   * Vanilla DOM NodeView — shows a styled pill with a human-readable label.
   * This is only used for the in-editor visual; getHTML() uses renderHTML above.
   */
  addNodeView() {
    return ({ node }) => {
      const name = node.attrs.name as string;
      const label = humanizeVariable(name);

      const dom = document.createElement("span");
      dom.setAttribute("data-variable", name);
      dom.setAttribute("contenteditable", "false");
      dom.className =
        "inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-sm font-medium select-none cursor-default mx-0.5";
      dom.textContent = label;

      return { dom };
    };
  },

  addCommands() {
    return {
      insertVariable:
        (name: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { name },
          });
        },
    };
  },
});
