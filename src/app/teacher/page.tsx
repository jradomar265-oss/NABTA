export default function TeacherHomePage() {
  return (
    <section className="max-w-3xl">
      <p className="text-sm font-bold uppercase text-[#b65e35]">Classroom overview</p>
      <h1 className="mt-3 text-4xl font-bold">Welcome to your workspace.</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-[#62776d]">
        Your teacher space is ready. Class and lesson tools will become available as their workflows are implemented.
      </p>
      <div className="mt-9 border-t border-[#dce4d8] pt-6">
        <p className="text-sm font-semibold">No classes have been added.</p>
        <p className="mt-2 text-sm text-[#62776d]">Class management is not available in this foundation stage.</p>
      </div>
    </section>
  );
}