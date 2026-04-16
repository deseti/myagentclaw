import BroadcastCampaignDashboard from '@/components/broadcast-campaign-dashboard';

export default function BroadcastCampaignDetailPage({ params }) {
  return <BroadcastCampaignDashboard initialCampaignId={params.id} />;
}