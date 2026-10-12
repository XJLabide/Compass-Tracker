import Link from "next/link";
import { PageHeader } from "@/app/daily-components";

const destinations = [
  { title: "Calendar", detail: "Timed events beside due work", href: "/calendar" },
  { title: "Projects", detail: "Shared tasks through custom stages", href: "/projects" },
  { title: "Goals", detail: "Qualitative and measurable progress", href: "/goals" },
  { title: "Fitness", detail: "Strength plans, workouts, runs, and sports", href: "/fitness" },
  { title: "Nutrition", detail: "Targets, meal templates, and check-ins", href: "/nutrition" },
  { title: "Tasks", detail: "Small actions, due dates, and your inbox", href: "/tasks" },
  { title: "Routines", detail: "Behaviors on the days you choose", href: "/routines" },
  { title: "History & backfill", detail: "Revisit a day without changing today", href: "/history" },
  { title: "Settings", detail: "Timezone, units, appearance, and account", href: "/settings" },
  { title: "Offline sync lab", detail: "Inspect pending changes and conflicts", href: "/sync-lab" },
];

export default function MorePage() {
  return (
    <div className="daily-page">
      <PageHeader title="More" subtitle="A few useful places around Compass" />
      <section className="surface-card more-list" aria-label="More pages">
        {destinations.map((item) => (
          <Link className="more-link" href={item.href} key={item.href}>
            <span><strong>{item.title}</strong><small>{item.detail}</small></span>
            <span className="row-chevron" aria-hidden="true">›</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
