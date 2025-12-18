import { SecureBadge } from "../ui/Badge";

export function FundsBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-950/30 via-slate-900 to-slate-900 border border-emerald-800/20 p-4 shadow-lg">
      {/* Subtle glow effect */}
      <div className="absolute -top-4 -right-4 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl" />
      
      <div className="relative flex items-start gap-3">
        {/* Shield icon */}
        <div className="flex-shrink-0 mt-0.5 p-2 rounded-xl bg-emerald-900/30 text-emerald-500">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" d="M12.516 2.17a.75.75 0 00-1.032 0 11.209 11.209 0 01-7.877 3.08.75.75 0 00-.722.515A12.74 12.74 0 002.25 9.75c0 5.942 4.064 10.933 9.563 12.348a.749.749 0 00.374 0c5.499-1.415 9.563-6.406 9.563-12.348 0-1.352-.272-2.636-.759-3.985a.75.75 0 00-.722-.516l-.143.001c-2.996 0-5.717-1.17-7.734-3.08zm3.094 8.016a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
          </svg>
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-slate-100">Funds Protected</h4>
            <SecureBadge />
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Your assets are held securely by immutable smart contracts on TON blockchain. No intermediaries.
          </p>
        </div>
      </div>
    </div>
  );
}
