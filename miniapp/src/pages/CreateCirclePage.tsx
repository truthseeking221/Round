import { TonConnectButton } from "@tonconnect/ui-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { ApiError } from "../lib/api";
import { createCircle } from "../lib/api";
import { useAuth } from "../auth/useAuth";
import { useSmartWallet } from "../hooks/useSmartWallet"; // Replaced
import { cn } from "../lib/cn";
import { Page } from "../components/layout/Page";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Label } from "../components/ui/Label";
import { AlertCard, Card, CardContent, StatCard } from "../components/ui/Card";
import { describeError } from "../lib/errors";

export function CreateCirclePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { connected } = useSmartWallet(); // Use Smart Wallet

  const [name, setName] = useState("");
  const [contribution, setContribution] = useState(""); 
  const [members, setMembers] = useState("");
  const [interval, setInterval] = useState<"weekly" | "monthly">("monthly");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const humanError = error ? describeError(error) : null;

  const contVal = useMemo(() => Number.parseFloat(contribution) || 0, [contribution]);
  const memVal = useMemo(() => Number.parseInt(members, 10) || 0, [members]);
  const totalPot = useMemo(() => contVal * memVal, [contVal, memVal]);
  const formValid = memVal >= 2 && memVal <= 12 && contVal > 0;

  const handleCreate = async () => {
    if (auth.status !== "ready") {
      setError({ code: "AUTH_REQUIRED", message: "Authentication is not ready yet. Please retry." });
      return;
    }
    // Check connected status from Smart Wallet (Mock is auto-connected)
    if (!connected) {
      setError({ code: "WALLET_NOT_CONNECTED", message: "Connect your wallet to create a circle." });
      return;
    }
    if (!formValid) {
      setError({ code: "INVALID_INPUT", message: "Invalid parameters (members 2–12, contribution > 0)." });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await createCircle(auth.token, {
        name: name.trim() || undefined,
        n_members: memVal,
        contribution_usdt: String(contVal),
        interval,
      });
      navigate(`/circle/${res.circle.circle_id}`);
    } catch (e: unknown) {
      const maybe = (e ?? {}) as { code?: unknown; message?: unknown };
      setError({
        code: typeof maybe.code === "string" && maybe.code.length > 0 ? maybe.code : "API_ERROR",
        message: typeof maybe.message === "string" && maybe.message.length > 0 ? maybe.message : "Failed to create circle.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page
      title="Create Circle"
      subtitle="Set up a trustless savings circle"
      maxWidth="lg"
      leading={
        <Link
          to="/"
          className={cn(
            "inline-flex items-center justify-center h-10 w-10 rounded-xl",
            "border border-slate-800/60 bg-slate-950/40 text-slate-300",
            "hover:bg-slate-900/60 hover:text-slate-100 transition-colors"
          )}
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
      }
      headerAction={<TonConnectButton className="scale-90 origin-right" />}
    >
      <div className="space-y-6">
        <Card variant="vault" className="animate-slide-up">
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Defaults</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatCard label="Fees" value="1%" subValue="winner pays" />
              <StatCard label="Grace" value="24h" subValue="late window" />
              <StatCard label="Discount cap" value="5%" subValue="max" />
              <StatCard label="Safety lock" value="On" subValue="cycle 1" />
            </div>
          </CardContent>
        </Card>

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

              <div className="space-y-2">
                <Label htmlFor="interval">Interval</Label>
                <Select
                  id="interval"
                  value={interval}
                  onChange={(e) => setInterval(e.target.value as "weekly" | "monthly")}
                  options={[
                    { value: "weekly", label: "Weekly" },
                    { value: "monthly", label: "Monthly" },
                  ]}
                />
              </div>

              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 mt-6">
                 <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Projected Economics</div>
                 <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                       <span className="text-slate-400">Total Pot per Round</span>
                       <span className="text-slate-200 font-mono font-bold">{totalPot.toLocaleString()} USDT</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Interval</span>
                      <span className="text-slate-200 font-mono font-bold">{interval === "weekly" ? "Weekly" : "Monthly"}</span>
                    </div>
                 </div>
              </div>

              {error && humanError ? (
                <AlertCard variant="error" title={humanError.title}>
                  {humanError.description}
                  <div className="mt-2 text-xs text-slate-500">Code: {error.code}</div>
                </AlertCard>
              ) : null}

              <Button 
                onClick={handleCreate} 
                loading={loading} 
                disabled={loading || !formValid}
                className="w-full h-12 text-base shadow-xl shadow-blue-500/10"
              >
                Create Circle
              </Button>

           </CardContent>
        </Card>
      </div>
    </Page>
  );
}
