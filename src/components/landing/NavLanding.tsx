"use client";

import { useEffect, useState } from "react";

const LINKS = [
  { href: "#produto", rotulo: "Produto" },
  { href: "#routing", rotulo: "Smart Routing" },
  { href: "#integracoes", rotulo: "Integrações" },
  { href: "#seguranca", rotulo: "Segurança" },
  { href: "#faq", rotulo: "FAQ" },
];

/**
 * Topo da landing, por cima do hero escuro. Abaixo de 1000px os links viram
 * um menu; o original escondia "Entrar" e "Criar conta" no celular sem pôr em
 * lugar nenhum, então eles entram no fim do menu.
 */
export default function NavLanding({ entrarHref, entrarRotulo, cadastroHref }: { entrarHref: string; entrarRotulo: string; cadastroHref: string }) {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [aberto]);

  return (
    <header className="topbar" id="top">
      <div className="shell nav-wrap">
        <a className="brand" href="#top" aria-label="VOX, início">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vox-logo.png" alt="" width={49} height={24} />
          <span>VOX</span>
        </a>
        <nav className={`nav${aberto ? " open" : ""}`} id="nav" aria-label="Navegação principal">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setAberto(false)}>
              {l.rotulo}
            </a>
          ))}
          <div className="nav-mobile-actions">
            <a className="nav-login" href={entrarHref}>
              {entrarRotulo}
            </a>
            <a className="button button-small button-primary" href={cadastroHref}>
              Criar conta
            </a>
          </div>
        </nav>
        <div className="nav-actions">
          <a className="nav-login" href={entrarHref}>
            {entrarRotulo}
          </a>
          <a className="button button-small button-primary" href={cadastroHref}>
            Criar conta
          </a>
        </div>
        <button
          type="button"
          className="menu-button"
          aria-label={aberto ? "Fechar menu" : "Abrir menu"}
          aria-expanded={aberto}
          aria-controls="nav"
          onClick={() => setAberto((a) => !a)}
        >
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
