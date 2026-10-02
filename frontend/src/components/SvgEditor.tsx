import paper from 'paper';
import { useEffect, useRef } from 'react';

interface SvgEditorProps {
  svg: string;
}

export function SvgEditor({ svg }: SvgEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scope = new paper.PaperScope();
    scope.setup(canvas);
    const item = scope.project.importSVG(svg, { expandShapes: true });
    item.fitBounds(scope.view.bounds);

    // TODO: select, knife/lasso split, recolor, undo/redo, export (docs/08-svg-editor.md)

    return () => {
      scope.project.remove();
    };
  }, [svg]);

  return <canvas ref={canvasRef} className="svg-editor" data-paper-resize="true" />;
}
