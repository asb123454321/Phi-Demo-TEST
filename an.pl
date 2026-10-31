open F,"<:utf8","c.txt"; my @ev;
while(<F>){ s/\x{feff}//g; next unless /\S/; my @p=split; push @ev,[$p[0],$p[2]+0,$p[3]+0,$p[4]+0,$p[5]+0,$p[6]+0]; }
# group by (end or start?) try grouping by start time
my %g; for(@ev){ push @{$g{ sprintf("%.3f",$_->[1]) }}, $_ }
my $cnt=0;
for my $t (sort {$a<=>$b} keys %g){ last if $cnt>14; $cnt++;
  my @l=@{$g{$t}};
  printf "t=%s  n=%d  ", $t, scalar @l;
  my %x; $x{sprintf("%.4f",$_->[3])}++ for @l;
  print "lanes(x): ", join(" ", map {"$_".($x{$_}>1?"*$x{$_}":"")} sort {$a<=>$b} keys %x);
  print "  | types: ", join(",", map {$_->[0]} @l), " dirs: ", join(",", map {$_->[4]} @l), "\n";
}
