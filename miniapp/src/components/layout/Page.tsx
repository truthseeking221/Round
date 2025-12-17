import * as React from "react";

export function Page(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 py-5">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="text-xl font-semibold text-slate-50">{props.title}</h1>
        <div className="mt-4">{props.children}</div>
      </div>
    </div>
  );
}

