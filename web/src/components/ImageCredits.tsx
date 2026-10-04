import { useState } from 'react';
import { Modal } from './Modal';
import credits from '../assets/produtos/creditos.json';

interface Credit { product: string; title: string; author: string; license: string; license_url: string; source: string }

/** “Créditos das imagens”: autor, licença e origem de cada foto de produto (também em docs/creditos-imagens.md). */
export function ImageCreditsLink() {
  const [open, setOpen] = useState(false);
  const list = credits as Credit[];
  return (
    <>
      <button type="button" className="linkish" onClick={() => setOpen(true)} data-testid="img-credits-open">Créditos das imagens</button>
      {open && (
        <Modal title="📷 Créditos das imagens" onClose={() => setOpen(false)} size="mid">
          <p className="small muted" style={{ marginTop: 0 }}>Fotos dos produtos de bancos de imagens livres (Wikimedia Commons / Openverse), usadas conforme a licença de cada uma. {list.length} fotos.</p>
          <ul className="credits-list" data-testid="img-credits">
            {list.map((c) => (
              <li key={c.product}><b>{c.product}</b>: “{c.title}”, por {c.author || 'autor desconhecido'} · {c.license_url ? <a href={c.license_url} target="_blank" rel="noreferrer">{c.license}</a> : c.license} · <a href={c.source} target="_blank" rel="noreferrer">origem</a></li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
