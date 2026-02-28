import React from 'react';
import Editor from '@monaco-editor/react';

interface CodeEditorProps {
    value: string;
    onChange: (value: string) => void;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange }) => {
    return (
        <Editor
            height="100%"
            defaultLanguage="javascript"
            theme="vs-dark"
            value={value}
            onChange={(val) => onChange(val || '')}
            options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on',
                padding: { top: 16 },
            }}
        />
    );
};

export default CodeEditor;
