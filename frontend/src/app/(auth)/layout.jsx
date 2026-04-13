export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">myagentclaw</h1>
          <p className="text-slate-400 mt-1 text-sm">AI Agent Platform untuk Bisnis Online</p>
        </div>
        {children}
      </div>
    </div>
  );
}
