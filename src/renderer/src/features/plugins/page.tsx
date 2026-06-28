import { usePluginsPageController } from './model/use-plugins-page-controller'
import { PluginsPageView } from './ui/plugins-page-view'

export default function PluginsPage(): React.ReactElement {
  const controller = usePluginsPageController()
  return <PluginsPageView controller={controller} />
}
