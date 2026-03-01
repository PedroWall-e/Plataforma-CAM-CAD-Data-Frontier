import React, { useRef, useEffect } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';

// ─── FabScript API Type Definitions ──────────────────────────────────────────
// These are injected as global declarations into Monaco so that the user gets
// full IntelliSense (autocomplete + hover docs) for the FabScript scripting API.
const FABSCRIPT_API_TYPES = `
declare class Path2D {
  /** All waypoints in this path. */
  readonly points: { x: number; y: number; z: number }[];
  /** Move the cursor to (x, y) without drawing. */
  moveTo(x: number, y: number): void;
  /** Draw a line from the current position to (x, y). */
  lineTo(x: number, y: number): void;
  /** Draw an arc centered at (cx, cy). Angles in radians. */
  arc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, segments?: number): void;
  /** Close the path by revisiting the first point. */
  close(): this;
}

declare class Tool {
  id: string;
  name: string;
  type: 'flat' | 'ball' | 'drill' | 'chamfer';
  diameter: number;
  /**
   * Define a cutting tool.
   * @param id Unique identifier e.g. 'T1'
   * @param name Human-readable label e.g. 'Fresa 6mm'
   * @param type Tool geometry type
   * @param diameter Diameter in mm
   */
  constructor(id: string, name: string, type: 'flat' | 'ball' | 'drill' | 'chamfer', diameter: number);
}

declare class Stock {
  width: number;
  height: number;
  depth: number;
  /**
   * Create a rectangular stock block.
   * @param width  Block width in mm (X axis)
   * @param height Block height in mm (Y axis)
   * @param depth  Block thickness in mm (Z axis)
   */
  constructor(width: number, height: number, depth: number);
  /**
   * Excavate a closed-pocket cavity.
   * @param path Closed Path2D defining the boundary
   * @param opts { depth: number, tool: Tool }
   */
  pocket(path: Path2D, opts: { depth: number; tool: Tool }): this;
  /**
   * Cut along the profile contour.
   * @param path Path2D defining the profile
   * @param opts { depth: number, side?: 'inside' | 'outside', tool: Tool }
   */
  profile(path: Path2D, opts: { depth: number; side?: 'inside' | 'outside'; tool: Tool }): this;
  /**
   * Drill holes at a list of XY positions.
   * @param points Array of { x, y } coordinates
   * @param opts { depth: number, tool: Tool }
   */
  drill(points: { x: number; y: number }[], opts: { depth: number; tool: Tool }): this;
}
`;

// ─── Public Types ─────────────────────────────────────────────────────────────
export interface EditorError {
    message: string;
    line?: number;
    column?: number;
}

interface CodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    error?: EditorError | null;
}

// ─── Component ────────────────────────────────────────────────────────────────
const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, error }) => {
    const monaco = useMonaco();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorRef = useRef<any>(null);

    // ── Inject FabScript typings once Monaco is available ──────────────────────
    useEffect(() => {
        if (!monaco) return;

        monaco.languages.typescript.javascriptDefaults.addExtraLib(
            FABSCRIPT_API_TYPES,
            'fabscript-api.d.ts'
        );

        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            noLib: true,
            allowNonTsExtensions: true,
            target: monaco.languages.typescript.ScriptTarget.ES2020,
        });
    }, [monaco]);

    // ── Sync error markers whenever the error prop changes ─────────────────────
    useEffect(() => {
        if (!monaco || !editorRef.current) return;

        const model = editorRef.current.getModel();
        if (!model) return;

        if (!error) {
            monaco.editor.setModelMarkers(model, 'fabscript', []);
            return;
        }

        // new Function() wraps in 2 extra lines — offset back to hit user code
        const adjustedLine = Math.max(1, (error.line ?? 1) - 2);

        monaco.editor.setModelMarkers(model, 'fabscript', [{
            severity: monaco.MarkerSeverity.Error,
            message: error.message,
            startLineNumber: adjustedLine,
            endLineNumber: adjustedLine,
            startColumn: error.column ?? 1,
            endColumn: model.getLineMaxColumn(adjustedLine),
        }]);
    }, [monaco, error]);

    const handleMount: OnMount = (editor) => {
        editorRef.current = editor;
    };

    return (
        <Editor
            height="100%"
            defaultLanguage="javascript"
            theme="vs-dark"
            value={value}
            onChange={(val) => onChange(val ?? '')}
            onMount={handleMount}
            options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on',
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                suggest: {
                    showClasses: true,
                    showConstructors: true,
                    showMethods: true,
                    showProperties: true,
                    showKeywords: true,
                },
            }}
        />
    );
};

export default CodeEditor;
