import { X } from 'lucide-react'
import { PaletteMark } from '../Logo'

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-5">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-sink text-[11px] font-semibold text-ink-muted">
          {n}
        </span>
        {title}
      </h3>
      <div className="mt-2 space-y-1.5 pl-7 text-[13.5px] leading-relaxed text-ink-soft">{children}</div>
    </section>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-sink px-1.5 py-0.5 font-mono text-[12px] text-ink">{children}</span>
}

export default function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-6" onClick={onClose}>
      <div
        className="my-8 w-full max-w-[640px] rounded-2xl border border-line bg-panel shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-2.5">
            <PaletteMark size={26} />
            <div>
              <div className="wordmark text-[18px] font-medium text-ink">MDesign 指南</div>
              <div className="text-[12px] text-ink-muted">用对话生成可用的设计，按项目管理</div>
            </div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-sink">
            <X size={17} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <p className="text-[13.5px] leading-relaxed text-ink-soft">
            MDesign 是一个<strong className="font-semibold text-ink">用聊天来做设计</strong>的工作台：你描述想要的东西，
            它会直接在项目里生成 HTML/JSX 文件，右侧实时预览。下面几步带你上手。
          </p>

          <Section n="1" title="新建项目">
            <p>左侧填项目名，选分类（Prototype / Slide deck / Template / Other），点 Create 进入工作区。</p>
            <p>左边是聊天，右边是 Design Files 与预览。项目、文件、聊天都自动保存在服务器，刷新不丢。</p>
          </Section>

          <Section n="2" title="用对话生成">
            <p>在底部输入框描述你要做的（页面 / 原型 / 组件 / 幻灯片）。</p>
            <p>
              它通常会先弹出一个 <strong className="font-semibold text-ink">Questions</strong> 页签问你几个选择题
              （用途、风格、布局…），点选后按右下角 <Pill>Continue</Pill>，答案会带回聊天并开始生成。
            </p>
            <p>复杂设计会被拆成多个小文件（组件 .jsx + 主 index.html），逐个出现、实时预览。</p>
          </Section>

          <Section n="3" title="文件与预览">
            <p>右侧 Design Files 里分 FOLDERS / PAGES / COMPONENTS。<strong className="font-semibold text-ink">单击</strong>文件在预览区查看，<strong className="font-semibold text-ink">双击</strong>在「Design Files」旁新开一个页签加载它。</p>
            <p>页签右上的 <Pill>Present</Pill> 会在浏览器新标签打开该页面（可 Cmd+P 存 PDF）。</p>
          </Section>

          <Section n="4" title="在预览里直接改">
            <p><strong className="font-semibold text-ink">Edit</strong> — 点选页面上的元素，左侧出属性面板，直接改文字和样式（字体 / 字号 / 颜色 / 对齐 / 间距 / 圆角…）。</p>
            <p><strong className="font-semibold text-ink">Tweaks</strong> — 实时调设计里的 CSS 变量（配色、字号等），即调即看，可保存回文件。</p>
            <p><strong className="font-semibold text-ink">Mark up</strong> — 在设计稿上画框 / 箭头 / 写标注，点「发给 Claude」把"改哪里 + 改什么"连同所指元素发回聊天，由我按标注修改。</p>
          </Section>

          <Section n="5" title="模型与提示词">
            <p>默认用 <Pill>ark-code-latest</Pill>（火山方舟 / Anthropic 协议）。在输入框的模型菜单 →「Model settings…」可切换 Anthropic / OpenAI、填 API Key、改 Base URL。</p>
            <p>系统提示词使用完整的 MDesign 设计规范，无需手动配置。</p>
          </Section>

          <Section n="6" title="保存与管理">
            <p>所有数据存在服务器端 SQLite，刷新 / 重启 / 换浏览器都在。</p>
            <p>在画廊里把鼠标移到项目卡右上角点「…」可重命名或删除项目。</p>
          </Section>
        </div>

        <div className="border-t border-line px-6 py-4">
          <button onClick={onClose} className="w-full rounded-lg bg-ink py-2.5 text-[14px] font-medium text-white hover:bg-ink-soft">
            开始使用
          </button>
        </div>
      </div>
    </div>
  )
}
