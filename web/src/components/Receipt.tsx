export type RLine =
  | { k: 'title'; text: string } | { k: 'center'; text: string; bold?: boolean } | { k: 'text'; text: string; bold?: boolean }
  | { k: 'lr'; left: string; right: string; bold?: boolean; big?: boolean } | { k: 'cols'; cells: string[]; bold?: boolean } | { k: 'hr' } | { k: 'blank' };

export function Receipt({ lines }: { lines: RLine[] }) {
  return (
    <div className="receipt">
      {lines.map((l, i) => {
        switch (l.k) {
          case 'title': return <div key={i} className="title">{l.text}</div>;
          case 'center': return <div key={i} className={`c ${l.bold ? 'b' : ''}`}>{l.text}</div>;
          case 'text': return <div key={i} className={l.bold ? 'b' : ''} style={{ whiteSpace: 'pre-wrap' }}>{l.text}</div>;
          case 'lr': return <div key={i} className={`lr ${l.bold ? 'b' : ''} ${l.big ? 'big' : ''}`}><span style={{ whiteSpace: 'pre' }}>{l.left}</span><span>{l.right}</span></div>;
          case 'cols': return <div key={i} className={`cols ${l.bold ? 'b' : ''}`}>{l.cells.map((c, j) => <span key={j}>{c}</span>)}</div>;
          case 'hr': return <hr key={i} />;
          default: return <div key={i}>&nbsp;</div>;
        }
      })}
    </div>
  );
}
