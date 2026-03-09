import { Wallet, Construction } from "lucide-react";

export default function Loonaangifte() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-emerald-100 rounded-lg">
          <Wallet className="text-emerald-600" size={24} />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">Loonaangifte</h2>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 flex flex-col items-center justify-center text-center">
        <div className="p-4 bg-amber-100 rounded-full mb-4">
          <Construction className="text-amber-600" size={32} />
        </div>
        <h3 className="text-lg font-semibold text-slate-700 mb-2">Binnenkort beschikbaar</h3>
        <p className="text-sm text-slate-500 max-w-md">
          De salarisadministratie module wordt op dit moment ontwikkeld en is nog niet functioneel.
        </p>
      </div>
    </div>
  );
}
