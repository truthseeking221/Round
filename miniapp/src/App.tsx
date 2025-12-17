import { Navigate, Route, Routes } from "react-router-dom";

import { AuthGate } from "./auth/AuthGate";
import { CirclePage } from "./pages/CirclePage";
import { CreateCirclePage } from "./pages/CreateCirclePage";
import { HomePage } from "./pages/HomePage";
import { JoinPage } from "./pages/JoinPage";
import { AuctionPage } from "./pages/AuctionPage";
import { WithdrawPage } from "./pages/WithdrawPage";

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreateCirclePage />} />
        <Route path="/circle/:circleId" element={<CirclePage />} />
        <Route path="/circle/:circleId/join" element={<JoinPage />} />
        <Route path="/circle/:circleId/auction" element={<AuctionPage />} />
        <Route path="/circle/:circleId/withdraw" element={<WithdrawPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthGate>
  );
}

export default App;
