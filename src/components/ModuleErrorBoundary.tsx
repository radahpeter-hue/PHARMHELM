import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  error: Error | null;
}

interface Props {
  children?: React.ReactNode;
}

export class ModuleErrorBoundary extends React.Component<Props, State> {
  declare props: Readonly<Props>;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Module rendering failed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="max-w-2xl mx-auto mt-12 rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-red-50 p-3 text-red-600">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-zinc-900">This module could not be displayed</h1>
            <p className="mt-2 text-sm text-zinc-600">
              The rest of PharmHelm is still available. Reload this module, and report the message below if the problem continues.
            </p>
            <p className="mt-4 rounded-xl bg-zinc-100 p-3 font-mono text-xs text-zinc-700">
              {this.state.error.message || 'Unknown module error'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl bg-zinc-900 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white"
            >
              Reload module
            </button>
          </div>
        </div>
      </div>
    );
  }
}
