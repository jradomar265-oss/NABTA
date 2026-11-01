export default function StudentHomePage() {
  return (
    <section className="max-w-3xl">
      <p className="text-sm font-bold uppercase text-[#b65e35]">Your next step starts here</p>
      <h1 className="mt-3 text-4xl font-bold">Welcome to your learning world.</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-[#62776d]">
        Your student space is ready. Assigned lessons and quests will appear here as classroom learning is connected.
      </p>
      <div className="mt-9 border-t border-[#dce4d8] pt-6">
        <p className="text-sm font-semibold">Learning activities are not set up yet.</p>
        <p className="mt-2 text-sm text-[#62776d]">Your teacher can let you know when your first activity is available.</p>
      </div>
    </section>
  );
}