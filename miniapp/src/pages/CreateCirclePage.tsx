import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { createCircle } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { useSmartWallet } from "../hooks/useSmartWallet"; // Replaced
import { Page } from "../components/layout/Page";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Label } from "../components/ui/Label";
import { Card, CardContent } from "../components/ui/Card";

export function CreateCirclePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { connected } = useSmartWallet(); // Use Smart Wallet

  const [name, setName] = useState("");
  const [contribution, setContribution] = useState(""); 
  const [members, setMembers] = useState("");
  const [collateralRate, setCollateralRate] = useState("150");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contVal = parseFloat(contribution) || 0;
  const memVal = parseInt(members) || 0;
  const colRateVal = parseFloat(collateralRate) || 0;
  
  const totalPot = contVal * memVal;
  const collateralRequired = (totalPot * colRateVal) / 100;

  const handleCreate = async () => {
    // Check connected status from Smart Wallet (Mock is auto-connected)
    if (!connected) {
      setError("Please connect your wallet first.");
      return;
    }
    if (contVal <= 0 || memVal < 2) {
      setError("Invalid parameters (min 2 members, >0 contribution).");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await createCircle(auth.token, {
        name: name.trim() || undefined,
        contribution_units: String(contVal),
        n_members: memVal,
        collateral_rate_bps: Math.round(colRateVal * 100),
      });
      navigate(`/circle/${res.circle_id}`);
    } catch (e: any) {
      setError(e.message || "Failed to create circle.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page title="New Circle">
      <div className="space-y-6 max-w-lg mx-auto">
        <div className="flex items-center justify-between">
           <Link to="/" className="text-sm text-slate-400 hover:text-slate-100 flex items-center gap-1">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
            </svg>
            Cancel
           </Link>
        </div>

        <div className="text-center mb-6">
           <h1 className="text-3xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
             Create Money Circle
           </h1>
           <p className="text-slate-400 text-sm mt-2">Set up a trustless ROSCA on TON.</p>
        </div>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-xl">
           <CardContent className="pt-6 space-y-5">
              <div className="space-y-2">
                 <Label htmlFor="name">Circle Name</Label>
                 <Input 
                   id="name" 
                   placeholder="e.g. Family Savings 2024" 
                   value={name} 
                   onChange={e => setName(e.target.value)}
                   className="font-display font-bold text-lg h-12"
                 />
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label htmlFor="contrib">Contribution (USDT)</Label>
                    <div className="relative">
                       <Input 
                         id="contrib" 
                         type="number" 
                         placeholder="100" 
                         value={contribution} 
                         onChange={e => setContribution(e.target.value)}
                         className="pr-12 font-mono font-bold"
                       />
                       <span className="absolute right-3 top-3 text-xs text-slate-500 font-bold">USDT</span>
                    </div>
                 </div>

                 <div className="space-y-2">
                    <Label htmlFor="members">Members</Label>
                    <Input 
                      id="members" 
                      type="number" 
                      placeholder="12" 
                      value={members} 
                      onChange={e => setMembers(e.target.value)}
                      className="font-mono font-bold"
                    />
                 </div>
              </div>

              <div className="space-y-2 pt-2">
                 <div className="flex justify-between">
                    <Label htmlFor="colRate">Collateral Rate (%)</Label>
                    <span className="text-xs font-mono text-emerald-400 font-bold">{collateralRate}%</span>
                 </div>
                 <div className="flex items-center gap-4">
                    <input 
                      type="range" 
                      min="100" 
                      max="200" 
                      step="10" 
                      value={collateralRate}
                      onChange={e => setCollateralRate(e.target.value)}
                      className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <Input 
                       type="number" 
                       value={collateralRate} 
                       onChange={e => setCollateralRate(e.target.value)}
                       className="w-20 text-center font-mono"
                    />
                 </div>
                 <p className="text-[10px] text-slate-500 leading-relaxed">
                   Higher collateral ensures safety. Members must lock {collateralRate}% of the total pot value to join.
                 </p>
              </div>

              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 mt-6">
                 <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Projected Economics</div>
                 <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                       <span className="text-slate-400">Total Pot per Round</span>
                       <span className="text-slate-200 font-mono font-bold">{totalPot.toLocaleString()} USDT</span>
                    </div>
                    <div className="flex justify-between text-sm">
                       <span className="text-slate-400">Security Deposit Required</span>
                       <span className="text-emerald-400 font-mono font-bold">{collateralRequired.toLocaleString()} USDT</span>
                    </div>
                 </div>
              </div>

              {error && (
                <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-lg text-red-300 text-sm text-center">
                  {error}
                </div>
              )}

              <Button 
                onClick={handleCreate} 
                loading={loading} 
                disabled={loading || !name || contVal <= 0 || memVal < 2}
                className="w-full h-12 text-base shadow-xl shadow-blue-500/10"
              >
                Launch Circle
              </Button>

           </CardContent>
        </Card>
      </div>
    </Page>
  );
}
