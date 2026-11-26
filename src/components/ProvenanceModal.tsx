/**
 * Modal acessível "De onde vem" exibindo origem exata (fonte, tabela/série, variável, ano e link) de cada valor.
 */

import { useEffect, useRef } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { formatIndicatorValue, type ProvenanceTarget } from '../types/territorial.ts';

interface ProvenanceModalProps {
  target: ProvenanceTarget | null;
  onClose: () => void;
}

export function ProvenanceModal({ target, onClose }: ProvenanceModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!target) return;
    closeBtnRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [target, onClose]);

  if (!target) return null;
  const { indicator, municipalityName, municipalityId, value, year, normalizedVulnerability } = target;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="provenance-title"
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-medium text-slate-600">Rastreabilidade do dado</p>
            <h2 id="provenance-title" className="mt-1 text-lg font-semibold text-slate-900">
              {indicator.nome}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {municipalityName} (IBGE {municipalityId})
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de origem do dado"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-md bg-slate-50 p-3">
            <dt className="text-xs text-slate-600">Valor observado ({year})</dt>
            <dd className="mt-1 font-mono-tabular text-base font-semibold text-slate-900">
              {formatIndicatorValue(value, indicator.unidade)}
            </dd>
          </div>

          <div className="rounded-md bg-slate-50 p-3">
            <dt className="text-xs text-slate-600">Score de vulnerabilidade (0–1)</dt>
            <dd className="mt-1 font-mono-tabular text-base font-semibold text-slate-900">
              {normalizedVulnerability !== null ? normalizedVulnerability.toFixed(3).replace('.', ',') : 'Fora do índice'}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-slate-600">Fonte oficial</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{indicator.fonte}</dd>
          </div>

          <div>
            <dt className="text-xs text-slate-600">Ano de referência</dt>
            <dd className="mt-0.5 font-mono-tabular font-medium text-slate-900">{year}</dd>
          </div>

          <div>
            <dt className="text-xs text-slate-600">Tabela / Série</dt>
            <dd className="mt-0.5 font-mono-tabular font-medium text-slate-900">{indicator.tabelaCodigo}</dd>
          </div>

          <div>
            <dt className="text-xs text-slate-600">Variável / Código</dt>
            <dd className="mt-0.5 font-mono-tabular font-medium text-slate-900">
              {indicator.variavelCodigo}
              {indicator.classificacao ? ` (${indicator.classificacao})` : ''}
            </dd>
          </div>
        </dl>

        <div className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-700">
          <p>{indicator.descricao}</p>
          {indicator.incluirNoIndice && (
            <p className="mt-2 text-xs text-slate-600">
              Regra no índice composto:{' '}
              {indicator.maiorEMelhor
                ? 'como maior valor indica melhor condição, o escore é invertido (1 − normalizado) para que 1 represente maior vulnerabilidade.'
                : 'maior valor já indica maior vulnerabilidade social, mantendo a direção direta (0 a 1).'}
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <a
            href={indicator.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-teal-800 underline hover:text-teal-950"
          >
            Abrir fonte oficial
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
